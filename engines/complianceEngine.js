// complianceEngine.js

const BLACKLIST = new Set([
  '0x1111111111111111111111111111111111111111',
  '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
]);

const HIGH_GAS_THRESHOLD = 5_000_000;
const INTERNAL_TRANSFER_THRESHOLD = 5;
const RISKY_OPCODES = new Set(['DELEGATECALL', 'CALLCODE', 'SELFDESTRUCT', 'CREATE', 'CREATE2']);

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
 * Detects abnormally high gas usage
 */
function checkHighGas(trace) {
  const finalGas = trace.gas || (trace.structLogs.at(-1)?.gas || 0);
  if (finalGas > HIGH_GAS_THRESHOLD) {
    return {
      rule: 'HIGH_GAS_USAGE',
      details: `Gas used: ${finalGas}`,
      flagged: true,
    };
  }
  return null;
}

/**
 * Detects excessive internal transfers (can indicate laundering/mixing)
 */
function checkInternalTransferFlood(trace) {
  const calls = trace.structLogs.filter(log => log.op === 'CALL');
  if (calls.length > INTERNAL_TRANSFER_THRESHOLD) {
    return {
      rule: 'INTERNAL_TRANSFER_FLOOD',
      details: `${calls.length} internal transfers detected`,
      flagged: true,
    };
  }
  return null;
}

/**
 * Detects suspicious opcodes in execution trace
 */
function checkRiskyOpcodes(trace) {
  const hits = trace.structLogs.filter(log => RISKY_OPCODES.has(log.op));
  if (hits.length > 0) {
    return {
      rule: 'RISKY_OPCODE_USAGE',
      details: `Opcodes used: ${[...new Set(hits.map(h => h.op))].join(', ')}`,
      flagged: true,
    };
  }
  return null;
}

/**
 * Detects if DELEGATECALL appears across multiple depths (possible reentrancy)
 */
function checkReentrancy(trace) {
  const depths = new Set();
  for (const log of trace.structLogs) {
    if (log.op === 'DELEGATECALL') {
      depths.add(log.depth);
    }
  }
  if (depths.size > 1) {
    return {
      rule: 'REENTRANCY_SUSPECTED',
      details: `Delegate calls at depths: ${[...depths].join(', ')}`,
      flagged: true,
    };
  }
  return null;
}

/**
 * Combine all rules and evaluate
 */
export function evaluateCompliance(trace, tx) {
  const results = [];

  const rules = [
    checkBlacklist,
    checkSelfTransferLoop,
    checkHighGas,
    checkInternalTransferFlood,
    checkRiskyOpcodes,
    checkReentrancy,
  ];

  for (const rule of rules) {
    const res = rule(trace, tx);
    if (res) results.push(res);
  }

  return results;
}
