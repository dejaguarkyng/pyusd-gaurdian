// API Routes
import { 
  getAlerts, 
  getAlertByTxHash, 
  saveAlert, 
  getUsersForNotification,
  saveNotificationPreferences,
  getNotificationPreferences,
  deleteNotificationPreferences 
} from './database.js';
import { logger } from './server.js';
import { notifyClients } from './utils.js';
import { pushToSheet } from './sheetsExporter.js';
import { sendDiscordAlert } from './discordNotifier.js';
import { sendEmailAlert } from './emailNotifier.js';
import { getMonitoringStatus } from './monitor.js';

/**
 * Process and distribute an alert to subscribed users based on their preferences
 * @param {Object} alert - The alert object to send
 * @returns {Promise<Object>} - Result of notification dispatch
 */
export async function processAlertNotifications(alert) {
  try {
    // Determine alert severity from risk report
    const severity = alert.riskReport?.severity || 'medium';
    
    // Get users who should be notified based on severity level
    const users = await getUsersForNotification(severity);
    
    if (!users || users.length === 0) {
      logger.info('No users subscribed for this alert severity', { severity });
      return { success: true, notifiedCount: 0 };
    }
    
    // Group users by notification frequency
    const immediateUsers = users.filter(user => user.frequency === 'immediate');
    const hourlyUsers = users.filter(user => user.frequency === 'hourly');
    const dailyUsers = users.filter(user => user.frequency === 'daily');
    
    // Send immediate notifications
    const results = await sendImmediateNotifications(immediateUsers, alert);
    
    // Queue other notifications based on frequency
    queueDelayedNotifications(hourlyUsers, alert, 'hourly');
    queueDelayedNotifications(dailyUsers, alert, 'daily');
    
    return {
      success: true,
      immediateNotifications: results,
      queued: {
        hourly: hourlyUsers.length,
        daily: dailyUsers.length
      }
    };
  } catch (error) {
    logger.error('Error processing alert notifications', { 
      error: error.message,
      alertId: alert.txHash
    });
    throw error;
  }
}

/**
 * Send immediate notifications to users
 * @param {Array} users - Users to notify
 * @param {Object} alert - Alert data
 * @returns {Promise<Object>} - Results of notifications
 */
async function sendImmediateNotifications(users, alert) {
  const results = {
    total: users.length,
    email: { sent: 0, failed: 0 },
    discord: { sent: 0, failed: 0 },
    telegram: { sent: 0, failed: 0 }
  };
  
  const notificationPromises = [];
  
  for (const user of users) {
    // Send email notifications
    if (user.email) {
      notificationPromises.push(
        sendEmailAlert(user.email, alert)
          .then(() => results.email.sent++)
          .catch(err => {
            results.email.failed++;
            logger.error('Email notification failed', { 
              error: err.message,
              userId: user.userId
            });
          })
      );
    }
    
    // Send Discord notifications
    if (user.discord) {
      notificationPromises.push(
        sendDiscordAlert(user.discord, alert)
          .then(() => results.discord.sent++)
          .catch(err => {
            results.discord.failed++;
            logger.error('Discord notification failed', { 
              error: err.message,
              userId: user.userId
            });
          })
      );
    }
    
    // Send Telegram notifications
    if (user.telegram) {
      notificationPromises.push(
        sendTelegramAlert(user.telegram, alert)
          .then(() => results.telegram.sent++)
          .catch(err => {
            results.telegram.failed++;
            logger.error('Telegram notification failed', { 
              error: err.message,
              userId: user.userId
            });
          })
      );
    }
  }
  
  await Promise.allSettled(notificationPromises);
  return results;
}

/**
 * Queue notifications for delayed delivery
 * @param {Array} users - Users to notify
 * @param {Object} alert - Alert data
 * @param {String} frequency - Frequency type ('hourly' or 'daily')
 */
function queueDelayedNotifications(users, alert, frequency) {
  if (users.length === 0) return;
  
  // In a production environment, you would use a proper job queue system
  // like Bull, Agenda, or a cloud-based queue service.
  // For now, we'll simply log that these would be queued
  
  logger.info(`Queued ${frequency} notifications for ${users.length} users`, {
    alertId: alert.txHash,
    frequency,
    userCount: users.length
  });
  
  // Here you would add the notifications to your job queue
  // Example with a hypothetical queue:
  /*
  queue.add('delayed-notifications', {
    users: users.map(u => u.userId),
    alertId: alert.txHash,
    frequency,
    scheduledFor: getNextScheduleTime(frequency)
  });
  */
}

/**
 * Get the next scheduled time for delayed notifications
 * @param {String} frequency - Either 'hourly' or 'daily'
 * @returns {Date} - Next scheduled time
 */
function getNextScheduleTime(frequency) {
  const now = new Date();
  
  if (frequency === 'hourly') {
    // Next hour, at the start of the hour
    now.setHours(now.getHours() + 1);
    now.setMinutes(0);
    now.setSeconds(0);
    now.setMilliseconds(0);
  } else if (frequency === 'daily') {
    // Next day, at a specific hour (e.g., 9 AM)
    now.setDate(now.getDate() + 1);
    now.setHours(9);
    now.setMinutes(0);
    now.setSeconds(0);
    now.setMilliseconds(0);
  }
  
  return now;
}

// Function for sending telegram alerts that was missing
function sendTelegramAlert(telegramUsername, alert) {
  // This would be your actual Telegram notification implementation
  return new Promise((resolve, reject) => {
    // Simulate API call to Telegram Bot API
    setTimeout(() => {
      logger.info('Telegram notification sent', { telegramUsername, alertId: alert.txHash });
      resolve();
    }, 100);
  });
}

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

  // Save notification preferences
  app.post('/api/notification-preferences', async (req, res) => {
    try {
      const { email, discord, telegram, severity, frequency } = req.body;
      
      // Validate the request
      if (!email && !discord && !telegram) {
        return res.status(400).json({ 
          error: 'Please select at least one notification method' 
        });
      }
      
      // Get the user ID (this would typically come from authentication)
      // For now, we'll use a default user ID for demonstration
      const userId = req.user?.id || 'default-user';
      
      // Create preferences object
      const preferencesData = {
        email: email || null,
        discord: discord || null,
        telegram: telegram || null,
        severity: severity || 'medium',
        frequency: frequency || 'immediate'
      };
      
      // Save to database
      const savedPreferences = await saveNotificationPreferences(userId, preferencesData);
      
      logger.info('Notification preferences saved', { 
        userId,
        email: email ? true : false,
        discord: discord ? true : false,
        telegram: telegram ? true : false,
        severity,
        frequency
      });
      
      // Return success response
      res.json({ 
        success: true, 
        message: 'Notification preferences saved successfully',
        preferences: savedPreferences
      });
    } catch (error) {
      logger.error('Error saving notification preferences', { error: error.message });
      res.status(500).json({ error: error.message || 'Failed to save notification preferences' });
    }
  });
  
  // Get user notification preferences
  app.get('/api/notification-preferences', async (req, res) => {
    try {
      // Get the user ID (this would typically come from authentication)
      // For now, we'll use a default user ID for demonstration
      const userId = req.user?.id || 'default-user';
      
      // Fetch from database
      const preferences = await getNotificationPreferences(userId);
      
      if (!preferences) {
        // Return default preferences if none are found
        return res.json({
          email: null,
          discord: null,
          telegram: null,
          severity: 'medium',
          frequency: 'immediate'
        });
      }
      
      res.json(preferences);
    } catch (error) {
      logger.error('Error fetching notification preferences', { error: error.message });
      res.status(500).json({ error: error.message || 'Failed to fetch notification preferences' });
    }
  });
  
  // Delete user notification preferences
  app.delete('/api/notification-preferences', async (req, res) => {
    try {
      // Get the user ID (this would typically come from authentication)
      const userId = req.user?.id || 'default-user';
      
      // Delete from database
      const deleted = await deleteNotificationPreferences(userId);
      
      if (deleted) {
        logger.info('Notification preferences deleted', { userId });
        res.json({ success: true, message: 'Notification preferences deleted successfully' });
      } else {
        res.status(404).json({ error: 'No notification preferences found for this user' });
      }
    } catch (error) {
      logger.error('Error deleting notification preferences', { error: error.message });
      res.status(500).json({ error: error.message || 'Failed to delete notification preferences' });
    }
  });
  
  // Test notification delivery (useful for development)
  app.post('/api/test-notification', async (req, res) => {
    try {
      const { severity } = req.body;
      
      if (!severity || !['low', 'medium', 'high', 'critical'].includes(severity)) {
        return res.status(400).json({ error: 'Valid severity level is required (low, medium, high, critical)' });
      }
      
      const testAlert = {
        txHash: `0xtest${Date.now()}`,
        blockNumber: 12345678,
        timestamp: new Date().toISOString(),
        rule: 'test-notification',
        details: `Test ${severity} alert notification`,
        riskReport: { 
          flagged: true, 
          severity: severity,
          issues: ['test-notification'] 
        }
      };
      
      // Get users who should receive this notification based on severity
      const users = await getUsersForNotification(severity);
      
      // Log the test notification
      logger.info('Test notification triggered', { 
        severity, 
        recipientCount: users.length 
      });
      
      // In a real implementation, you would send the notifications here
      // For now, just return the users who would be notified
      res.json({ 
        success: true, 
        message: `Test ${severity} notification would be sent to ${users.length} users`,
        testAlert,
        recipientCount: users.length
      });
    } catch (error) {
      logger.error('Error sending test notification', { error: error.message });
      res.status(500).json({ error: error.message || 'Failed to send test notification' });
    }
  });
}