import nodemailer from 'nodemailer';
import { config } from 'dotenv';
import mongoose from 'mongoose';
import NotificationPreference from './models/NotificationPreference.js'; // Adjust path as needed

config();

const transporter = nodemailer.createTransport({
  host: 'mail.tokenated.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_FROM,
    pass: process.env.EMAIL_PASSWORD,
  },
  tls: {
    rejectUnauthorized: true
  }
});

export async function sendEmailAlert(alertData) {
  const severityLevels = ['low', 'medium', 'high', 'critical'];

  const alertSeverityIndex = severityLevels.indexOf(alertData.severity?.toLowerCase() || 'medium');

  // 1. Fetch all users with an email preference and matching severity or set to 'all'
  const recipients = await NotificationPreference.find({
    email: { $exists: true, $ne: null },
    $or: [
      { severity: 'all' },
      {
        severity: { $in: severityLevels.slice(alertSeverityIndex) }
      }
    ]
  });

  if (!recipients.length) {
    console.log('📭 No users subscribed for this severity level.');
    return false;
  }

  // 2. Loop through and send alert to each
  for (const user of recipients) {
    const userEmail = user.email;
    if (!userEmail) continue;

    const mailOptions = {
      from: `"PYUSD Guardian" <${process.env.EMAIL_FROM}>`,
      to: userEmail,
      subject: `🚨 PYUSD Risk Alert: ${alertData.rule}`,
      html: generateEmailHtml(alertData) // Refactored email template logic into a separate function
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`📧 Email sent to ${userEmail} (MessageID: ${info.messageId})`);
    } catch (err) {
      console.error(`❌ Failed to email ${userEmail}:`, err.message);
    }
  }

  return true;
}


 function generateEmailHtml(alertData) {
  const colors = {
    darkGold: '#B8860B',
    gold: '#D4AF37',
    lightGold: '#F5DEB3',
    accentGold: '#FFD700',
    navy: '#0C2340',
    cream: '#FFFAEB',
    darkText: '#29231c',
    lightText: '#FFFFFF'
  };

  const getSeverityColor = (severity) => {
    switch (severity?.toLowerCase() || 'medium') {
      case 'critical': return '#D32F2F';
      case 'high': return '#F57C00';
      case 'medium': return colors.gold;
      case 'low': return '#4CAF50';
      default: return colors.gold;
    }
  };

  const severityColor = getSeverityColor(alertData.severity);
  const timestamp = new Date().toLocaleString();
  const shortHash = alertData.txHash.substring(0, 10) + '...' + alertData.txHash.substring(58);

  const formatJsonData = (data) => {
    if (!data) return 'No data available';
    try {
      return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    } catch {
      return 'Error formatting data';
    }
  };

  const walletAddresses = [];
  if (alertData.fromAddress) walletAddresses.push({ label: 'From', address: alertData.fromAddress });
  if (alertData.toAddress) walletAddresses.push({ label: 'To', address: alertData.toAddress });

  const walletAddressesHtml = walletAddresses.length > 0 ? `
    <div style="margin-bottom: 20px;">
      <h3 style="margin-bottom: 10px; border-bottom: 1px solid ${colors.lightGold}; padding-bottom: 5px; color: ${colors.darkGold};">Key Addresses</h3>
      ${walletAddresses.map(wallet => `
        <div style="margin-bottom: 8px;">
          <strong>${wallet.label}:</strong>
          <a href="https://etherscan.io/address/${wallet.address}" style="color: ${colors.darkGold}; text-decoration: none; word-break: break-all;">
            ${wallet.address}
          </a>
        </div>
      `).join('')}
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>PYUSD Guardian Alert</title></head>
<body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: ${colors.darkText}; max-width: 800px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
<div style="border-radius: 8px; border: 1px solid ${colors.lightGold}; overflow: hidden; box-shadow: 0 4px 15px rgba(184, 134, 11, 0.15);">
  <div style="background: linear-gradient(135deg, ${colors.gold} 0%, ${colors.darkGold} 100%); padding: 20px; color: ${colors.lightText};">
    <table width="100%" border="0" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <h1 style="margin: 0; font-size: 24px; text-shadow: 1px 1px 2px rgba(0,0,0,0.2);">PYUSD Guardian Alert</h1>
          <p style="margin: 5px 0 0; font-size: 14px;">Alert generated at ${timestamp}</p>
        </td>
        <td align="right">
          <div style="font-size: 28px; width: 50px; height: 50px; line-height: 50px; text-align: center; background-color: rgba(255,255,255,0.2); border-radius: 50%; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">🛡️</div>
        </td>
      </tr>
    </table>
  </div>

  <div style="padding: 25px; background-color: ${colors.cream};">
    <div style="background: linear-gradient(to right, ${colors.lightGold}10, ${colors.lightGold}40); border-left: 4px solid ${colors.gold}; border-radius: 6px; padding: 20px; margin-bottom: 25px;">
      <h2 style="margin-top: 0; margin-bottom: 15px; color: ${colors.navy}; font-size: 18px;">Alert Summary</h2>
      <div style="display: flex; flex-wrap: wrap; gap: 15px;">
        <div style="flex: 1; min-width: 200px;">
          <p><strong>Rule Violated:</strong><br> <span style="color: ${colors.darkGold}; font-weight: 600;">${alertData.rule}</span></p>
          <p><strong>Severity:</strong><br> 
            <span style="display: inline-block; background-color: ${severityColor}; color: white; padding: 3px 10px; border-radius: 4px; font-weight: bold;">
              ${alertData.severity || 'MEDIUM'}
            </span>
          </p>
        </div>
        <div style="flex: 1; min-width: 200px;">
          <p><strong>Transaction:</strong><br>
            <a href="https://etherscan.io/tx/${alertData.txHash}" style="color: ${colors.darkGold}; text-decoration: none; word-break: break-all; font-family: monospace; font-size: 14px; background-color: rgba(212, 175, 55, 0.1); padding: 2px 6px; border-radius: 3px;">
              ${shortHash}
            </a>
          </p>
          <p><strong>Block:</strong><br> <span style="font-family: monospace; font-size: 14px;">${alertData.blockNumber || 'N/A'}</span></p>
        </div>
      </div>
    </div>

    <div style="margin-bottom: 25px;">
      <h3 style="margin-bottom: 12px; border-bottom: 2px solid ${colors.lightGold}; padding-bottom: 8px; color: ${colors.darkGold};">Alert Details</h3>
      <div style="background-color: white; border-radius: 6px; padding: 15px; box-shadow: 0 1px 3px rgba(184, 134, 11, 0.1);">
        <p style="white-space: pre-line; margin: 0;">${alertData.details}</p>
      </div>
    </div>

    ${walletAddressesHtml ? `
    <div style="background-color: white; border-radius: 6px; padding: 15px; margin-bottom: 25px; box-shadow: 0 1px 3px rgba(184, 134, 11, 0.1);">
      ${walletAddressesHtml}
    </div>` : ''}

    <div style="margin-top: 25px;">
      <h3 style="margin-bottom: 12px; border-bottom: 2px solid ${colors.lightGold}; padding-bottom: 8px; color: ${colors.darkGold};">Risk Report</h3>
      <pre style="background: white; border: 1px solid ${colors.lightGold}; border-radius: 6px; padding: 15px; overflow-x: auto; font-size: 13px; line-height: 1.5; margin: 0; box-shadow: 0 1px 3px rgba(184, 134, 11, 0.1);">${formatJsonData(alertData.riskReport)}</pre>
    </div>

    <div style="margin-top: 35px; text-align: center;">
      <a href="https://etherscan.io/tx/${alertData.txHash}" style="display: inline-block; background: linear-gradient(135deg, ${colors.gold} 0%, ${colors.darkGold} 100%); color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin-right: 15px; font-weight: bold; box-shadow: 0 3px 6px rgba(184, 134, 11, 0.2); transition: all 0.3s ease;">
        View Transaction
      </a>
      <a href="${process.env.DASHBOARD_URL || '#'}" style="display: inline-block; background-color: ${colors.navy}; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; box-shadow: 0 3px 6px rgba(12, 35, 64, 0.2); transition: all 0.3s ease;">
        Open Dashboard
      </a>
    </div>
  </div>

  <div style="background: linear-gradient(to right, ${colors.lightGold}20, ${colors.lightGold}60); padding: 15px; text-align: center; font-size: 13px; color: ${colors.darkGold}; border-top: 1px solid ${colors.lightGold};">
    <table width="100%" border="0" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34..." width="24" height="24" style="vertical-align: middle; margin-right: 8px;">
          <p style="margin: 0; display: inline-block; vertical-align: middle;">This is an automated alert from the PYUSD Guardian monitoring system.</p>
        </td>
      </tr>
      <tr>
        <td align="center">
          <p style="margin: 8px 0 0;">© ${new Date().getFullYear()} PYUSD Guardian | <a href="${process.env.SETTINGS_URL || '#'}" style="color: ${colors.darkGold}; text-decoration: none;">Manage Alert Settings</a></p>
        </td>
      </tr>
    </table>
  </div>
</div>
</body>
</html>`;
}
