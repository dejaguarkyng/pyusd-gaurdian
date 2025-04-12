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
  try {
    // Add defensive checks for all properties
    if (!tx) {
      logger.warn(`Null or undefined transaction received`, { blockNumber });
      return;
    }
    
    // Safely access transaction properties with fallbacks
    const txHash = tx.hash || '0x0';
    const to = tx.to ? String(tx.to).toLowerCase() : null;
    const from = tx.from ? String(tx.from).toLowerCase() : null;
    const input = tx.data || tx.input || '';
    
    // Skip if transaction doesn't have required fields
    if (!from) {
      logger.warn(`Transaction missing 'from' field, skipping`, { txHash, blockNumber });
      return;
    }
    
    // Check if transaction involves PYUSD
    const involvesPYUSD = (
      to === PYUSD_ADDRESS ||
      from === PYUSD_ADDRESS ||
      (typeof input === 'string' && input.includes(PYUSD_ADDRESS.slice(2)))
    );
    
    if (!involvesPYUSD) return;
    
    logger.info(`PYUSD-related TX found`, { txHash, blockNumber });
    
    const trace = await withRetry(() => getTransactionTrace(txHash));
    if (!trace) {
      logger.warn(`No trace available for transaction`, { txHash });
      return;
    }
    
    const report = analyzeTrace(trace);
    const complianceFlags = evaluateCompliance(trace, tx);
    
    if (report.flagged || complianceFlags.length > 0) {
      logger.warn(`Transaction flagged for compliance issues`, { 
        txHash, 
        flags: complianceFlags.map(f => f.rule) 
      });
      
      for (const issue of complianceFlags) {
        const alert = {
          txHash,
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
          logger.error('Failed to save alert to database', { error: err.message, txHash });
        }

        // Notify WebSocket clients
        notifyClients(alert);

        // Execute external alerts in parallel but handle failures individually
        await Promise.allSettled([
          pushToSheet(alert).catch(err => logger.error('Failed to push to sheet', { error: err.message, txHash })),
          sendDiscordAlert(alert).catch(err => logger.error('Failed to send Discord alert', { error: err.message, txHash })),
          sendEmailAlert(alert).catch(err => logger.error('Failed to send email alert', { error: err.message, txHash })),
        ]);
      }
    }
  } catch (error) {
    const txHash = tx && tx.hash ? tx.hash : 'unknown';
    logger.error(`Error processing transaction`, { txHash, error: error.message });
  }
}

// Safely get block transactions for cases where getBlock with transactions might fail
async function getBlockTransactions(blockNumber) {
  try {
    // First try to get the block with transactions
    const block = await provider.getBlock(blockNumber, true);
    if (!block) {
      throw new Error(`No block returned for block number ${blockNumber}`);
    }
    return block.transactions || [];
  } catch (error) {
    logger.warn(`Failed to get block with transactions directly, trying alternative approach`, { 
      blockNumber, 
      error: error.message 
    });
    
    // Fallback method: get transaction hashes, then fetch each transaction
    try {
      const block = await provider.getBlock(blockNumber);
      if (!block || !block.transactions || !Array.isArray(block.transactions)) {
        throw new Error('Invalid block data received');
      }
      
      // Fetch each transaction by hash with proper error handling
      const transactions = [];
      for (const txHash of block.transactions) {
        try {
          const tx = await withRetry(() => provider.getTransaction(txHash));
          if (tx) {
            transactions.push(tx);
          }
        } catch (txError) {
          logger.error(`Failed to fetch transaction`, { txHash, error: txError.message });
          // Continue with other transactions
        }
      }
      
      return transactions;
    } catch (fallbackError) {
      logger.error(`Fallback method to get transactions also failed`, { 
        blockNumber, 
        error: fallbackError.message 
      });
      throw fallbackError;
    }
  }
}

// Process a block using the safer transaction fetching method
async function processBlockSafely(blockNumber) {
  try {
    logger.info(`Processing block`, { blockNumber });
    
    const transactions = await withRetry(() => getBlockTransactions(blockNumber));
    logger.info(`Retrieved transactions`, { blockNumber, txCount: transactions.length });
    
    // Process each transaction individually with proper error handling
    const results = await Promise.all(
      transactions.map(tx => 
        limit(() => 
          processTransaction(tx, blockNumber)
            .catch(error => {
              logger.error(`Failed to process transaction`, { 
                txHash: tx?.hash || 'unknown',
                error: error.message 
              });
              return false;
            })
        )
      )
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
        
        // Process each block individually with proper error handling
        let successfulBlocks = 0;
        for (let blockNumber = start; blockNumber <= end; blockNumber++) {
          try {
            const success = await processBlockSafely(blockNumber);
            if (success) successfulBlocks++;
          } catch (blockError) {
            logger.error(`Failed to process block`, { 
              blockNumber, 
              error: blockError.message 
            });
          }
        }
        
        if (successfulBlocks < (end - start + 1)) {
          logger.warn(`Some blocks failed to process`, { 
            total: (end - start + 1), 
            successful: successfulBlocks 
          });
        }
        
        // Update latest block even if some blocks failed
        latestBlock = end;
      }
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


app.post('/api/test-alert', async (req, res) => {
  const fakeAlert = {
    txHash: '0xdeadbeef',
    blockNumber: 123456,
    timestamp: new Date().toISOString(),
    rule: 'manual-test',
    details: 'This is a manual test alert',
    riskReport: { flagged: true, issues: ['test-issue'] }
  };

  await saveAlert(fakeAlert);
  notifyClients(fakeAlert);
  await Promise.allSettled([
    pushToSheet(fakeAlert),
    sendDiscordAlert(fakeAlert),
    sendEmailAlert(fakeAlert)
  ]);

  res.json({ status: 'Test alert pushed' });
});



// Extended API endpoint for debug information
app.get('/api/debug/provider', async (req, res) => {
  try {
    // Get basic provider information without exposing sensitive details
    const network = await provider.getNetwork();
    const blockNumber = await provider.getBlockNumber();
    
    res.json({
      network: {
        name: network.name,
        chainId: network.chainId
      },
      currentBlock: blockNumber,
      connectionStatus: 'connected'
    });
  } catch (error) {
    logger.error('Error fetching provider debug info', { error: error.message });
    res.status(500).json({ error: error.message, status: 'disconnected' });
  }
});

// Debug endpoint to check transaction format
app.get('/api/debug/transaction/:blockNumber/:index', async (req, res) => {
  try {
    const blockNumber = parseInt(req.params.blockNumber);
    const index = parseInt(req.params.index);
    
    const block = await provider.getBlock(blockNumber, true);
    if (!block || !block.transactions || index >= block.transactions.length) {
      return res.status(404).json({ error: 'Block or transaction not found' });
    }
    
    const tx = block.transactions[index];
    // Return a safe representation without sensitive data
    res.json({
      hash: tx.hash,
      blockNumber: tx.blockNumber,
      from: tx.from || null,
      to: tx.to || null,
      hasData: Boolean(tx.data || tx.input),
      properties: Object.keys(tx)
    });
  } catch (error) {
    logger.error('Error fetching transaction debug info', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
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
  // Don't exit on all uncaught exceptions - try to keep the service running
  // Only exit if it's a critical error
  if (error.message.includes('ECONNREFUSED') || error.message.includes('Invalid RPC response')) {
    logger.error('Critical error detected, exiting process', { error: error.message });
    process.exit(1);
  }
});

// Start server and monitoring
server.listen(PORT, async () => {
  logger.info(`PYUSD Monitor API server running on port ${PORT}`);
  
  // Test provider connection before starting monitoring
  try {
    const blockNumber = await provider.getBlockNumber();
    logger.info(`Successfully connected to Ethereum node`, { blockNumber });
    logger.info('PYUSD Transaction Monitor starting');
    monitorBlocks();
  } catch (error) {
    logger.error(`Failed to connect to Ethereum node. Please check your RPC_URL`, { error: error.message });
    process.exit(1);
  }
});