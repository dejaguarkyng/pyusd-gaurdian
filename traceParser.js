const riskyOpcodes = new Set([
  'DELEGATECALL',
  'CALLCODE',
  'SELFDESTRUCT',
  'CREATE',
  'CREATE2',
]);

const stackManipulationOpcodes = new Set([
  'CALLDATALOAD', 'CALLDATACOPY',
  'SLOAD', 'SSTORE', 'MLOAD', 'MSTORE',
  'JUMP', 'JUMPI',
]);

/**
 * @param {object} trace - The result from debug_traceTransaction
 * @returns {object} risk report
 */
export function analyzeTrace(trace) {
  const report = {
    riskyOpcodes: [],
    stackManipulation: [],
    opcodeFrequency: {},
    depthMax: 0,
    gasSpikeDetected: false,
    highGasUsage: false,
    reentrancySuspected: false,
    largeReturnData: false,
    totalSteps: 0,
    flagged: false,
  };

  let lastGas = null;
  let delegateCallDepths = new Set();

  for (const step of trace.structLogs) {
    report.totalSteps++;

    // Track opcode frequency
    report.opcodeFrequency[step.op] = (report.opcodeFrequency[step.op] || 0) + 1;

    // Risky opcodes
    if (riskyOpcodes.has(step.op)) {
      report.riskyOpcodes.push({
        op: step.op,
        pc: step.pc,
        depth: step.depth,
      });
      report.flagged = true;

      // Record DELEGATECALL depth for reentrancy suspicion
      if (step.op === 'DELEGATECALL') {
        delegateCallDepths.add(step.depth);
      }
    }

    // Stack manipulation detection
    if (stackManipulationOpcodes.has(step.op)) {
      report.stackManipulation.push({
        op: step.op,
        pc: step.pc,
        depth: step.depth,
      });
    }

    // Detect jump patterns
    if (step.op === 'JUMPI' || step.op === 'JUMP') {
      // flag arbitrary jump (heuristic: high jump frequency might indicate obfuscation or evasion)
      if (report.opcodeFrequency[step.op] > 5) {
        report.flagged = true;
      }
    }

    // Call depth tracking
    if (step.depth > report.depthMax) {
      report.depthMax = step.depth;
    }

    // Gas spike detection
    if (lastGas !== null && step.gas > lastGas * 1.5) {
      report.gasSpikeDetected = true;
      report.flagged = true;
    }

    lastGas = step.gas;
  }

  // Flag if total gas usage is unusually high (heuristic threshold)
  const finalGas = trace.gas || (trace.structLogs.at(-1)?.gas || 0);
  if (finalGas > 5_000_000) {
    report.highGasUsage = true;
    report.flagged = true;
  }

  // Reentrancy heuristic: DELEGATECALLs at multiple depths
  if (delegateCallDepths.size > 1) {
    report.reentrancySuspected = true;
    report.flagged = true;
  }

  // Large return data check (if available)
  if (trace.returnValue && trace.returnValue.length > 1024 * 8) {
    report.largeReturnData = true;
    report.flagged = true;
  }

  return report;
}
