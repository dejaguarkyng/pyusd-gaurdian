import nodemailer from 'nodemailer';
import { config } from 'dotenv';

config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_FROM,
    pass: process.env.EMAIL_PASSWORD,
  },
});

/**
 * Sends an email alert for a flagged transaction
 * @param {Object} alertData - Alert data with txHash, rule, details, etc.
 */
export async function sendEmailAlert(alertData) {
  const mailOptions = {
    from: `"PYUSD Guardian" <${process.env.EMAIL_FROM}>`,
    to: process.env.EMAIL_TO,
    subject: `🚨 PYUSD Risk Alert: ${alertData.rule}`,
    html: `
      <h2>PYUSD Guardian Alert</h2>
      <p><strong>Transaction:</strong> <a href="https://etherscan.io/tx/${alertData.txHash}">${alertData.txHash}</a></p>
      <p><strong>Rule Violated:</strong> ${alertData.rule}</p>
      <p><strong>Details:</strong> ${alertData.details}</p>
      <pre style="background:#eee;padding:10px;">${JSON.stringify(alertData.riskReport, null, 2)}</pre>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('📧 Email alert sent!');
  } catch (err) {
    console.error('❌ Failed to send email alert:', err.message);
  }
}
