// Import dependencies
import { config } from 'dotenv';
import { ethers } from 'ethers';
import { getTransactionTrace } from './traceAnalyzer.js';
import { analyzeTrace } from './traceParser.js';
import { evaluateCompliance } from './complianceEngine.js';
import { pushToSheet } from './sheetsExporter.js';
import { sendDiscordAlert } from './discordNotifier.js';
import { sendEmailAlert } from './emailNotifier.js';
import pLimit from 'p-limit';
import winston from 'winston';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import { saveAlert, getAlerts, getAlertByTxHash } from './database.js';

// Load environment variables
config();

// Constants (moved to environment variables where appropriate)
const PYUSD_ADDRESS = (process.env.PYUSD_ADDRESS || '0x6c3ea9036406852006290770b2e17e0e4f37f978').toLowerCase();
const RPC_URL = process.env.RPC_URL;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000');
const MAX_BLOCKS_PER_BATCH = parseInt(process.env.MAX_BLOCKS_PER_BATCH || '10');
const MAX_CONCURRENT_TRACES = parseInt(process.env.MAX_CONCURRENT_TRACES || '5');
const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || '2000');
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3');
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

// Setup logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'pyusd-monitor.log' })
  ],
});

// Initialize Express and WebSocket server
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST']
  }
});

// Apply middleware
app.use(cors());
app.use(express.json());

// Initialize provider with fallback and timeout
let provider;
try {
  provider = new ethers.JsonRpcProvider(RPC_URL, undefined, {
    polling: true,
    pollingInterval: 4000,
    timeout: 30000,
  });
} catch (error) {
  logger.error('Failed to initialize provider', { error: error.message });
  process.exit(1);
}

// Concurrency limiter
const limit = pLimit(MAX_CONCURRENT_TRACES);

// Track latest scanned block
let latestBlock = parseInt(process.env.STARTING_BLOCK || '0');

// Helper function to notify clients via WebSocket
function notifyClients(alert) {
  io.emit('new-alert', alert);
  logger.info('Sent alert to connected clients', { txHash: alert.txHash });
}

// Helper function with retry logic
async function withRetry(fn, retryCount = 0) {
  try {
    return await fn();
  } catch (error) {
    if (retryCount >= MAX_RETRIES) {
      throw error;
    }
    logger.warn(`Retrying after error: ${error.message}`, { retryCount });
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    return withRetry(fn, retryCount + 1);
  }
}

// Process a single transaction
async function processTransaction(tx, blockNumber) {
  const to = tx.to ? tx.to.toLowerCase() : null;
  const from = tx.from.toLowerCase();
  const input = tx.data;
  
  // Check if transaction involves PYUSD
  const involvesPYUSD = (
    to === PYUSD_ADDRESS ||
    from === PYUSD_ADDRESS ||
    input.includes(PYUSD_ADDRESS.slice(2))
  );
  
  if (!involvesPYUSD) return;
  
  logger.info(`PYUSD-related TX found`, { txHash: tx.hash, blockNumber });
  
  try {
    const trace = await withRetry(() => getTransactionTrace(tx.hash));
    if (!trace) {
      logger.warn(`No trace available for transaction`, { txHash: tx.hash });
      return;
    }
    
    const report = analyzeTrace(trace);
    const complianceFlags = evaluateCompliance(trace, tx);
    
    if (report.flagged || complianceFlags.length > 0) {
      logger.warn(`Transaction flagged for compliance issues`, { 
        txHash: tx.hash, 
        flags: complianceFlags.map(f => f.rule) 
      });
      
      for (const issue of complianceFlags) {
        const alert = {
          txHash: tx.hash,
          blockNumber,
          timestamp: new Date().toISOString(),
          rule: issue.rule,
          details: issue.details,
          riskReport: report,
        };

        // Save to database
        try {
          await saveAlert(alert);
        } catch (err) {
          logger.error('Failed to save alert to database', { error: err.message, txHash: tx.hash });
        }

        // Notify WebSocket clients
        notifyClients(alert);

        // Execute external alerts in parallel but handle failures individually
        await Promise.allSettled([
          pushToSheet(alert).catch(err => logger.error('Failed to push to sheet', { error: err.message, txHash: tx.hash })),
          sendDiscordAlert(alert).catch(err => logger.error('Failed to send Discord alert', { error: err.message, txHash: tx.hash })),
          sendEmailAlert(alert).catch(err => logger.error('Failed to send email alert', { error: err.message, txHash: tx.hash })),
        ]);
      }
    }
  } catch (error) {
    logger.error(`Error processing transaction`, { txHash: tx.hash, error: error.message });
  }
}

// Process a single block
async function processBlock(blockNumber) {
  try {
    // Get block with transactions using ethers.js standard methods
    const block = await withRetry(() => provider.getBlock(blockNumber, true));
    logger.info(`Scanning block`, { blockNumber, txCount: block.transactions.length });

    // Process transactions with concurrency limit
    await Promise.all(
      block.transactions.map(tx => limit(() => processTransaction(tx, blockNumber)))
    );
    
    return true;
  } catch (error) {
    logger.error(`Error processing block`, { blockNumber, error: error.message });
    return false;
  }
}

// Main monitoring function
async function monitorBlocks() {
  // Initialize starting block if needed
  if (!latestBlock) {
    try {
      latestBlock = await withRetry(() => provider.getBlockNumber());
      logger.info(`Starting from block`, { blockNumber: latestBlock });
    } catch (error) {
      logger.error(`Failed to get latest block number, retrying in ${POLL_INTERVAL_MS}ms`, { error: error.message });
      setTimeout(monitorBlocks, POLL_INTERVAL_MS);
      return;
    }
  }

  try {
    const currentBlock = await withRetry(() => provider.getBlockNumber());

    if (currentBlock > latestBlock) {
      logger.info(`Processing new blocks`, { from: latestBlock + 1, to: currentBlock });
      
      // Process blocks in batches to avoid memory issues
      for (let start = latestBlock + 1; start <= currentBlock; start += MAX_BLOCKS_PER_BATCH) {
        const end = Math.min(start + MAX_BLOCKS_PER_BATCH - 1, currentBlock);
        
        // Process batch of blocks
        const blockPromises = [];
        for (let blockNumber = start; blockNumber <= end; blockNumber++) {
          blockPromises.push(processBlock(blockNumber));
        }
        
        const results = await Promise.all(blockPromises);
        const successfulBlocks = results.filter(Boolean).length;
        
        if (successfulBlocks < results.length) {
          logger.warn(`Some blocks failed to process`, { 
            total: results.length, 
            successful: successfulBlocks 
          });
        }
      }

      latestBlock = currentBlock;
    }
  } catch (error) {
    logger.error(`Error during block monitoring`, { error: error.message });
  } finally {
    // Schedule next check with fixed interval
    setTimeout(monitorBlocks, POLL_INTERVAL_MS);
  }
}

// API Routes
app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    currentBlock: latestBlock,
    uptime: process.uptime()
  });
});

app.get('/api/alerts', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const alerts = await getAlerts(parseInt(page), parseInt(limit));
    res.json(alerts);
  } catch (error) {
    logger.error('Error fetching alerts', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/alerts/:txHash', async (req, res) => {
  try {
    const { txHash } = req.params;
    const alert = await getAlertByTxHash(txHash);
    
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }
    
    res.json(alert);
  } catch (error) {
    logger.error('Error fetching alert details', { error: error.message, txHash: req.params.txHash });
    res.status(500).json({ error: error.message });
  }
});

// WebSocket connections
io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id });
  
  socket.on('disconnect', () => {
    logger.info('Client disconnected', { socketId: socket.id });
  });
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT. Shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM. Shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

// Start server and monitoring
server.listen(PORT, () => {
  logger.info(`PYUSD Monitor API server running on port ${PORT}`);
  logger.info('PYUSD Transaction Monitor starting');
  monitorBlocks();
});