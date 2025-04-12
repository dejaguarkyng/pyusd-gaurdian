import nodemailer from 'nodemailer';
import { config } from 'dotenv';

config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_FROM,
    pass: process.env.EMAIL_PASSWORD,
  },
  // Add optional security settings
  tls: {
    rejectUnauthorized: true
  }
});

/**
 * Sends an enhanced gold-themed email alert for a flagged transaction
 * @param {Object} alertData - Alert data with txHash, rule, details, etc.
 * @returns {Promise<boolean>} - Success status of email sending
 */
export async function sendEmailAlert(alertData) {
  // Gold theme colors
  const colors = {
    darkGold: '#B8860B',     // Dark goldenrod
    gold: '#D4AF37',         // Classic gold
    lightGold: '#F5DEB3',    // Wheat/light gold
    accentGold: '#FFD700',   // Pure gold
    navy: '#0C2340',         // Deep navy for contrast
    cream: '#FFFAEB',        // Creamy background
    darkText: '#29231c',     // Dark brown text
    lightText: '#FFFFFF'     // White text
  };
  
  // Determine severity color based on risk level
  const getSeverityColor = (severity) => {
    switch(severity?.toLowerCase() || 'medium') {
      case 'critical': return '#D32F2F'; // Red
      case 'high': return '#F57C00';     // Orange
      case 'medium': return colors.gold; // Gold for medium
      case 'low': return '#4CAF50';      // Green
      default: return colors.gold;       // Default gold
    }
  };
  
  const severityColor = getSeverityColor(alertData.severity);
  const timestamp = new Date().toLocaleString();
  const shortHash = alertData.txHash.substring(0, 10) + '...' + alertData.txHash.substring(58);
  
  // Format any JSON data for better readability
  const formatJsonData = (data) => {
    if (!data) return 'No data available';
    
    try {
      const jsonString = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      return jsonString;
    } catch (err) {
      return 'Error formatting data';
    }
  };
  
  // Extract wallet addresses for quick exploration
  const walletAddresses = [];
  if (alertData.fromAddress) walletAddresses.push({label: 'From', address: alertData.fromAddress});
  if (alertData.toAddress) walletAddresses.push({label: 'To', address: alertData.toAddress});
  
  // Generate wallet address HTML if any addresses are available
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

  const mailOptions = {
    from: `"PYUSD Guardian" <${process.env.EMAIL_FROM}>`,
    to: process.env.EMAIL_TO,
    subject: `🚨 PYUSD Risk Alert: ${alertData.rule}`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>PYUSD Guardian Alert</title>
      </head>
      <body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: ${colors.darkText}; max-width: 800px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="border-radius: 8px; border: 1px solid ${colors.lightGold}; overflow: hidden; box-shadow: 0 4px 15px rgba(184, 134, 11, 0.15);">
          <!-- Alert Header -->
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
          
          <!-- Alert Content -->
          <div style="padding: 25px; background-color: ${colors.cream};">
            <!-- Alert Summary -->
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
            
            <!-- Transaction Details -->
            <div style="margin-bottom: 25px;">
              <h3 style="margin-bottom: 12px; border-bottom: 2px solid ${colors.lightGold}; padding-bottom: 8px; color: ${colors.darkGold};">Alert Details</h3>
              <div style="background-color: white; border-radius: 6px; padding: 15px; box-shadow: 0 1px 3px rgba(184, 134, 11, 0.1);">
                <p style="white-space: pre-line; margin: 0;">${alertData.details}</p>
              </div>
            </div>
            
            <!-- Wallet Addresses Section -->
            ${walletAddressesHtml ? `
            <div style="background-color: white; border-radius: 6px; padding: 15px; margin-bottom: 25px; box-shadow: 0 1px 3px rgba(184, 134, 11, 0.1);">
              ${walletAddressesHtml}
            </div>` : ''}
            
            <!-- Risk Report -->
            <div style="margin-top: 25px;">
              <h3 style="margin-bottom: 12px; border-bottom: 2px solid ${colors.lightGold}; padding-bottom: 8px; color: ${colors.darkGold};">Risk Report</h3>
              <pre style="background: white; border: 1px solid ${colors.lightGold}; border-radius: 6px; padding: 15px; overflow-x: auto; font-size: 13px; line-height: 1.5; margin: 0; box-shadow: 0 1px 3px rgba(184, 134, 11, 0.1);">${formatJsonData(alertData.riskReport)}</pre>
            </div>
            
            <!-- Actions -->
            <div style="margin-top: 35px; text-align: center;">
              <a href="https://etherscan.io/tx/${alertData.txHash}" style="display: inline-block; background: linear-gradient(135deg, ${colors.gold} 0%, ${colors.darkGold} 100%); color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin-right: 15px; font-weight: bold; box-shadow: 0 3px 6px rgba(184, 134, 11, 0.2); transition: all 0.3s ease;">
                View Transaction
              </a>
              <a href="${process.env.DASHBOARD_URL || '#'}" style="display: inline-block; background-color: ${colors.navy}; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; box-shadow: 0 3px 6px rgba(12, 35, 64, 0.2); transition: all 0.3s ease;">
                Open Dashboard
              </a>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background: linear-gradient(to right, ${colors.lightGold}20, ${colors.lightGold}60); padding: 15px; text-align: center; font-size: 13px; color: ${colors.darkGold}; border-top: 1px solid ${colors.lightGold};">
            <table width="100%" border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center">
                  <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAACXBIWXMAAAsTAAALEwEAmpwYAAABt0lEQVR4nO2UvWsUURTFf2dmXRNFUvgVhDSuiBYWVmJnYSH+AWKVwioWFiLYpLASC8HGRrCwEBHsUtlYCBYKfkQJKGpQdlfcnXnP4r0xk9lZNoHELsPAg3vPu/fcc++5M/A//jkSLDuB/W3EE8Pv4soNINKlHiDeBNkHHAXuLAO8ApwBBsCQyBDoAQdaTzVc5BLu3Ts+ZrqmtDmKoaLl3PCy18tz1eGRz2KiQhSGNS/Xh9boCXoVJ0q++YkCrFxPLTkG/AJ2/SH9VZEBcHCUzVdNcC2KdEP2Jsl+ArtEdxD+QrRX9GqNmvZqxAkRw1CxXnSGOxdXl3YBMLqD8BdiOQkJR5tFaLWGBx1M1I9Ei5GxKWLYVLHdYrGHQA5cBza3TRCLXGwW4a4jJsQ2KkEKyIDzSwI4J5wA+jHRgVj5PiQMzSgAV9o2CbmBDNwGrrfVzfgBvDODdWAReKZBOc5pnT3OU+SeBGYT4lxr9jg91ZbSR2bEzMgQsQ/3l8BaXXQP8FnDspDrg9Z5sUu7OkBk5MA+82QgKNhspgYuPwTnK+Apcn/Rsg54/W/HH8QPzA3+GW7Pz/cAAAAASUVORK5CYII=" alt="Shield" width="24" height="24" style="vertical-align: middle; margin-right: 8px;">
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
      </html>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('📧 Gold-themed email alert sent!', info.messageId);
    return true;
  } catch (err) {
    console.error('❌ Failed to send email alert:', err.message);
    return false;
  }
}