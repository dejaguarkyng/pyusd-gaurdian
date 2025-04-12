import { ethers } from 'ethers';

import { provider } from './provider.js'; 

/**
 * Sends a raw RPC call to GCP Ethereum node for debug_traceTransaction
 * @param {string} txHash - Transaction hash to trace
 * @returns {Object} - Full execution trace
 */
export async function getTransactionTrace(txHash) {
  const tracePayload = {
    method: 'debug_traceTransaction',
    params: [txHash, {}],
    id: 1,
    jsonrpc: '2.0',
  };

  try {
    const res = await provider.send(tracePayload.method, tracePayload.params);
    return res;
  } catch (err) {
    console.error(`❌ Error getting trace for ${txHash}:`, err.message);
    return null;
  }
}
