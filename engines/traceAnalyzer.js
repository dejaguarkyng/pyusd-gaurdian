import { ethers } from 'ethers';
import { provider } from './provider.js';

/**
 * Validates if the given value is a valid 0x-prefixed transaction hash
 * @param {string} hash
 */
function isValidTxHash(hash) {
  return /^0x([A-Fa-f0-9]{64})$/.test(hash);
}

/**
 * Sends a raw RPC call to GCP Ethereum node for debug_traceTransaction
 * @param {string} txHash - Transaction hash to trace
 * @returns {Object|null} - Full execution trace or null on failure
 */
export async function getTransactionTrace(txHash) {
  if (!isValidTxHash(txHash)) {
    console.error(`❌ Invalid transaction hash: ${txHash}`);
    return null;
  }

  const tracePayload = {
    method: 'debug_traceTransaction',
    params: [txHash, {}],
    id: 1,
    jsonrpc: '2.0',
  };

  try {
    const res = await provider.send(tracePayload.method, tracePayload.params);

    if (!res || typeof res !== 'object' || !Array.isArray(res.structLogs)) {
      console.warn(`⚠️ Trace for ${txHash} returned unexpected format.`);
      return null;
    }

    return res;
  } catch (err) {
    console.error(`❌ Error tracing tx ${txHash}: ${err.message}`);
    // Optional: Retry once on specific errors
    if (err.message.includes('timeout') || err.code === 'ETIMEDOUT') {
      console.warn(`🔁 Retrying trace for ${txHash}...`);
      try {
        const retryRes = await provider.send(tracePayload.method, tracePayload.params);
        return retryRes;
      } catch (retryErr) {
        console.error(`❌ Retry failed for ${txHash}:`, retryErr.message);
      }
    }

    return null;
  }
}
