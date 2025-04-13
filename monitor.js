// Transaction monitoring functionality
import pLimit from 'p-limit';
import { getTransactionTrace } from './traceAnalyzer.js';
import { analyzeTrace } from './traceParser.js';
import { evaluateCompliance } from './complianceEngine.js';
import { pushToSheet } from './sheetsExporter.js';
import { sendDiscordAlert } from './discordNotifier.js';
import { sendEmailAlert } from './emailNotifier.js';
import { saveAlert } from './database.js';
import { logger } from './server.js';
import { 
  PYUSD_ADDRESS, 
  MAX_CONCURRENT_TRACES, 
  POLL_INTERVAL_MS, 
  MAX_BLOCKS_PER_BATCH,
  STARTING_BLOCK
} from './config.js';
import { withRetry, getBlockTransactions, notifyClients } from './utils.js';

// Concurrency limiter
const limit = pLimit(MAX_CONCURRENT_TRACES);

// Track latest scanned block
let latestBlock = STARTING_BLOCK;

// Process a single transaction
async function processTransaction(tx, blockNumber, io) {
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
        notifyClients(io, alert);

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

// Process a block using the safer transaction fetching method
async function processBlockSafely(provider, blockNumber, io) {
  try {
    logger.info(`Processing block`, { blockNumber });
    
    const transactions = await withRetry(() => getBlockTransactions(provider, blockNumber));
    logger.info(`Retrieved transactions`, { blockNumber, txCount: transactions.length });
    
    // Process each transaction individually with proper error handling
    const results = await Promise.all(
      transactions.map(tx => 
        limit(() => 
          processTransaction(tx, blockNumber, io)
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
async function monitorBlocks(provider, io) {
  // Initialize starting block if needed
  if (!latestBlock) {
    try {
      latestBlock = await withRetry(() => provider.getBlockNumber());
      logger.info(`Starting from block`, { blockNumber: latestBlock });
    } catch (error) {
      logger.error(`Failed to get latest block number, retrying in ${POLL_INTERVAL_MS}ms`, { error: error.message });
      setTimeout(() => monitorBlocks(provider, io), POLL_INTERVAL_MS);
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
            const success = await processBlockSafely(provider, blockNumber, io);
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
    setTimeout(() => monitorBlocks(provider, io), POLL_INTERVAL_MS);
  }
}

// Start monitoring blocks
export function startMonitoring(provider, io) {
  monitorBlocks(provider, io);
}

// Get current monitoring status
export function getMonitoringStatus() {
  return {
    currentBlock: latestBlock,
    status: 'running'
  };
}