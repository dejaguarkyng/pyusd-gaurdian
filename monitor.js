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
  if (!tx || typeof tx !== 'object') {
    logger.warn(`Null or malformed transaction received`, { blockNumber });
    return;
  }
  
  console.log('fuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuckfuck');
  try {
    // Add defensive checks for all properties
    if (!tx) {
      logger.warn(`Null or undefined transaction received`, { blockNumber });
      return;
    }
    console.log(tx);
    // Safely access transaction properties with fallbacks
    const txHash = tx.hash || '0x0';
    const to = tx.to ? String(tx.to).toLowerCase() : null;
    const from = tx.from ? String(tx.from).toLowerCase() : null;
    const input = tx.data || tx.input || '';
    const value = tx.value ? tx.value.toString() : '0';

    // Skip if transaction doesn't have required fields
    if (!from) {
      logger.warn(`Transaction missing 'from' field, skipping`, { txHash, blockNumber });
      return;
    }

    // Save every PYUSD transaction (limited to 1000)
    const involvesPYUSD = (
      to === PYUSD_ADDRESS ||
      from === PYUSD_ADDRESS ||
      (typeof input === 'string' && input.includes(PYUSD_ADDRESS.slice(2)))
    );

    if (involvesPYUSD) {
      logger.info(`PYUSD-related TX found`, { txHash, blockNumber });


      try {
        await saveTransaction({
          txHash,
          blockNumber,
          timestamp: new Date(),
          from,
          to,
          input,
          value
        });

        logger.error('Save transaction to database', { error: err.message, txHash });
      } catch (err) {
        logger.error('Failed to save transaction to database', { error: err.message, txHash });
      }

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
    }
  } catch (error) {
    const txHash = tx && tx.hash ? tx.hash : 'unknown';
    logger.error(`Error processing transaction`, { txHash, error: error.message });
  }
}


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

    // Count how many transactions were successfully processed
    const successfulTxs = results.filter(result => result !== false).length;
    const failedTxs = results.length - successfulTxs;

    // Log transaction processing results
    if (failedTxs > 0) {
      logger.warn(`Block processing completed with some failures`, {
        blockNumber,
        total: transactions.length,
        successful: successfulTxs,
        failed: failedTxs
      });
    } else {
      logger.info(`Block processing completed successfully`, {
        blockNumber,
        totalTxs: transactions.length
      });
    }

    // Return more detailed information about the processing result
    return {
      success: true,
      blockNumber,
      totalTxs: transactions.length,
      successfulTxs,
      failedTxs
    };
  } catch (error) {
    logger.error(`Error processing block`, { blockNumber, error: error.message });
    return {
      success: false,
      blockNumber,
      error: error.message
    };
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

      for (let start = latestBlock + 1; start <= currentBlock; start += MAX_BLOCKS_PER_BATCH) {
        const end = Math.min(start + MAX_BLOCKS_PER_BATCH - 1, currentBlock);
        let successfulBlocks = 0;

        for (let blockNumber = start; blockNumber <= end; blockNumber++) {
          try {
            const result = await processBlockSafely(provider, blockNumber, io);
            if (result.success) {
              successfulBlocks++;
              if (result.failedTxs > 0) {
                logger.warn(`Block processed with partial transaction failures`, {
                  blockNumber,
                  failedTxs: result.failedTxs,
                  totalTxs: result.totalTxs
                });
              }
            }
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

        // ✅ This now updates properly after the batch is done
        latestBlock = end;
      }
    }
  } catch (error) {
    logger.error(`Error during block monitoring`, { error: error.message });
  } finally {
    setTimeout(() => monitorBlocks(provider, io), POLL_INTERVAL_MS);
  }
}



// // Start monitoring blocks
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