// API Routes
import { getAlerts, getAlertByTxHash, saveAlert } from './database.js';
import { logger } from './server.js';
import { notifyClients } from './utils.js';
import { pushToSheet } from './sheetsExporter.js';
import { sendDiscordAlert } from './discordNotifier.js';
import { sendEmailAlert } from './emailNotifier.js';
import { getMonitoringStatus } from './monitor.js';

export function setupRoutes(app, provider) {
  // Status endpoint
  app.get('/api/status', (req, res) => {
    const status = getMonitoringStatus();
    res.json({
      ...status,
      uptime: process.uptime()
    });
  });

  // Get all alerts with pagination
  app.get('/api/alerts', async (req, res) => {
    try {
      const { page = 1, limit = 20 } = req.query;
      const alerts = await getAlerts(parseInt(page), parseInt(limit));
      res.json(alerts);
    } catch (error) {
      logger.error('Error fetching alerts', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Get alert by transaction hash
  app.get('/api/alerts/:txHash', async (req, res) => {
    try {
      const { txHash } = req.params;
      const alert = await getAlertByTxHash(txHash);
      
      if (!alert) {
        return res.status(404).json({ error: 'Alert not found' });
      }
      
      res.json(alert);
    } catch (error) {
      logger.error('Error fetching alert details', { error: error.message, txHash: req.params.txHash });
      res.status(500).json({ error: error.message });
    }
  });

  // Test alert functionality
  app.post('/api/test-alert', async (req, res) => {
    const fakeAlert = {
      txHash: '0xdeadbeef',
      blockNumber: 123456,
      timestamp: new Date().toISOString(),
      rule: 'manual-test',
      details: 'This is a manual test alert',
      riskReport: { flagged: true, issues: ['test-issue'] }
    };

    await saveAlert(fakeAlert);
    // Use req.app.get('io') to get the WebSocket instance
    const io = req.app.get('io');
    notifyClients(io, fakeAlert);
    await Promise.allSettled([
      pushToSheet(fakeAlert),
      sendDiscordAlert(fakeAlert),
      sendEmailAlert(fakeAlert)
    ]);

    res.json({ status: 'Test alert pushed' });
  });

  // Provider debug info
  app.get('/api/debug/provider', async (req, res) => {
    try {
      // Get basic provider information without exposing sensitive details
      const network = await provider.getNetwork();
      const blockNumber = await provider.getBlockNumber();
      
      res.json({
        network: {
          name: network.name,
          chainId: network.chainId
        },
        currentBlock: blockNumber,
        connectionStatus: 'connected'
      });
    } catch (error) {
      logger.error('Error fetching provider debug info', { error: error.message });
      res.status(500).json({ error: error.message, status: 'disconnected' });
    }
  });

  // Transaction debug info
  app.get('/api/debug/transaction/:blockNumber/:index', async (req, res) => {
    try {
      const blockNumber = parseInt(req.params.blockNumber);
      const index = parseInt(req.params.index);
      
      const block = await provider.getBlock(blockNumber, true);
      if (!block || !block.transactions || index >= block.transactions.length) {
        return res.status(404).json({ error: 'Block or transaction not found' });
      }
      
      const tx = block.transactions[index];
      // Return a safe representation without sensitive data
      res.json({
        hash: tx.hash,
        blockNumber: tx.blockNumber,
        from: tx.from || null,
        to: tx.to || null,
        hasData: Boolean(tx.data || tx.input),
        properties: Object.keys(tx)
      });
    } catch (error) {
      logger.error('Error fetching transaction debug info', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });
}