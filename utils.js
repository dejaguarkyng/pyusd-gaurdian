// Utility functions
import { ethers } from 'ethers';
import { RPC_URL, MAX_RETRIES, RETRY_DELAY_MS } from './config.js';
import { logger } from './server.js';

// Initialize provider with fallback and timeout
export function initializeProvider() {
  try {
    return new ethers.JsonRpcProvider(RPC_URL, undefined, {
      polling: true,
      pollingInterval: 4000,
      timeout: 30000,
    });
  } catch (error) {
    logger.error('Failed to initialize provider', { error: error.message });
    process.exit(1);
  }
}

// Helper function with retry logic
export async function withRetry(fn, retryCount = 0) {
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

// Notify WebSocket clients
export function notifyClients(io, alert) {
  io.emit('new-alert', alert);
  logger.info('Sent alert to connected clients', { txHash: alert.txHash });
}




// Get all transactions from a block using various fallback strategies
export async function getBlockTransactions(provider, blockNumber) {
  try {
    // First attempt: get full block with transactions
    const block = await provider.getBlock(blockNumber, true);
    if (!block) {
      throw new Error(`No block returned for block number ${blockNumber}`);
    }
    console.log('Full block.transactions:', block.transactions);
    return block.transactions || [];

  } catch (error) {
    logger.warn(`Failed to get block with transactions directly, trying fallback by tx hashes`, { 
      blockNumber, 
      error: error.message 
    });

    try {
      // Fallback: get block, then fetch each transaction hash in batches
      const block = await provider.getBlock(blockNumber);
      if (!block || !Array.isArray(block.transactions)) {
        throw new Error('Invalid block structure');
      }

      const txHashes = block.transactions;
      const batchSize = 50;
      const transactions = [];

      for (let i = 0; i < txHashes.length; i += batchSize) {
        const batch = txHashes.slice(i, i + batchSize);

        const results = await Promise.allSettled(
          batch.map(txHash => withRetry(() => provider.getTransaction(txHash)))
        );

        results.forEach((result, idx) => {
          const txHash = batch[idx];
          if (result.status === 'fulfilled' && result.value) {
            transactions.push(result.value);
          } else {
            logger.error(`Failed to fetch transaction in batch`, {
              txHash,
              error: result.reason?.message || result.reason
            });
          }
        });
      }

      console.log('Fetched transactions from hashes (batch fallback):', transactions);
      if (transactions.length > 0) return transactions;

      // If we got nothing, try final fallback
      throw new Error('No transactions fetched from block hashes');

    } catch (fallbackError) {
      logger.warn(`Fallback by tx hashes failed, trying debug_traceBlockByNumber`, { 
        blockNumber, 
        error: fallbackError.message 
      });

      try {
        // Final fallback: trace block to extract transactions
        const traceResults = await withRetry(() => 
          provider.send('debug_traceBlockByNumber', [toHex(blockNumber), {}])
        );

        if (traceResults) {
          traceResults.forEach((trace, idx) => {
            if (!trace || !trace.action || !trace.action.from) {
              logger.warn('Skipping malformed trace entry', {
                blockNumber,
                index: idx,
                rawTrace: trace
              });
            }
          });
        }
        
        const transactions = (traceResults || [])
          .filter(trace => trace && trace.action && trace.action.from)
          .map((trace, index) => ({
            hash: trace.transactionHash || `unknown-${blockNumber}-${index}`,
            from: trace.action?.from || null,
            to: trace.action?.to || null,
            input: trace.action?.input || '',
            value: trace.action?.value || '0x0',
          }));
      
        console.log('Final fallback - traced transactions:', transactions);
        return transactions;
      } catch (traceError) {
        logger.error(`debug_traceBlockByNumber failed as last resort`, { 
          blockNumber, 
          error: traceError.message 
        });
        throw traceError;
      }
    }
  }
}

// Utility to convert number to hex
function toHex(num) {
  return '0x' + Number(num).toString(16);
}
