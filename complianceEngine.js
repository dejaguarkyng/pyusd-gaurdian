// complianceEngine.js

// EXAMPLE: Blacklisted addresses (can later be dynamic)
const BLACKLIST = new Set([
    '0x1111111111111111111111111111111111111111',
    '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  ]);
  
  /**
   * Checks if the transaction involves any blacklisted addresses
   */
  function checkBlacklist(tx) {
    const to = tx.to?.toLowerCase();
    const from = tx.from?.toLowerCase();
  
    if (BLACKLIST.has(to) || BLACKLIST.has(from)) {
      return {
        rule: 'BLACKLISTED_ADDRESS',
        details: `${from} -> ${to}`,
        flagged: true,
      };
    }
  
    return null;
  }
  
  /**
   * Detects self-transfer behavior (loops)
   */
  function checkSelfTransferLoop(trace, tx) {
    const transfers = trace.structLogs.filter(log =>
      ['CALL', 'CALLCODE'].includes(log.op)
    );
  
    const loopDetected = transfers.some(log => {
      const stack = log.stack;
      if (stack && stack.length >= 2) {
        const recipientHex = stack[stack.length - 2]; // second last: recipient
        const recipientAddr = '0x' + recipientHex.slice(-40).toLowerCase();
        return recipientAddr === tx.from.toLowerCase();
      }
      return false;
    });
  
    return loopDetected
      ? {
          rule: 'SELF_TRANSFER_LOOP',
          details: `Loop detected from ${tx.from}`,
          flagged: true,
        }
      : null;
  }
  
  /**
   * Combine all rules and evaluate
   */
  export function evaluateCompliance(trace, tx) {
    const results = [];
  
    const blacklist = checkBlacklist(tx);
    if (blacklist) results.push(blacklist);
  
    const loop = checkSelfTransferLoop(trace, tx);
    if (loop) results.push(loop);
  
    // Additional rules can be added here...
  
    return results;
  }
  