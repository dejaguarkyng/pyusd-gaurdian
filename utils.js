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

// Safely get block transactions for cases where getBlock with transactions might fail
export async function getBlockTransactions(provider, blockNumber) {
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