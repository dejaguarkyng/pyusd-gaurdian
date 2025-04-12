// traceParser.js

const riskyOpcodes = new Set([
    'DELEGATECALL',
    'CALLCODE',
    'SELFDESTRUCT',
    'CREATE',
    'CREATE2',
  ]);
  
  /**
   * Analyze a transaction trace for anomalies and compliance risks
   * @param {object} trace - The result from debug_traceTransaction
   * @returns {object} risk report
   */
  export function analyzeTrace(trace) {
    const report = {
      riskyOpcodes: [],
      depthMax: 0,
      gasSpikeDetected: false,
      totalSteps: 0,
      flagged: false,
    };
  
    let lastGas = null;
  
    for (const step of trace.structLogs) {
      report.totalSteps++;
  
      // Track risky opcodes
      if (riskyOpcodes.has(step.op)) {
        report.riskyOpcodes.push({
          op: step.op,
          pc: step.pc,
          depth: step.depth,
        });
        report.flagged = true;
      }
  
      // Track call depth
      if (step.depth > report.depthMax) {
        report.depthMax = step.depth;
      }
  
      // Detect gas spikes
      if (lastGas !== null && step.gas > lastGas * 1.5) {
        report.gasSpikeDetected = true;
        report.flagged = true;
      }
  
      lastGas = step.gas;
    }
  
    return report;
  }
  