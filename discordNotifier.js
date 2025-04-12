import fetch from 'node-fetch';
import { config } from 'dotenv';

config();

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

export async function sendDiscordAlert(alertData) {
  const payload = {
    content: `🚨 **PYUSD Risk Alert**
**TX:** [${alertData.txHash}](https://etherscan.io/tx/${alertData.txHash})
**Rule:** ${alertData.rule}
**Details:** ${alertData.details}
`,
  };

  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log('🔔 Discord alert sent!');
  } catch (err) {
    console.error('❌ Discord webhook failed:', err.message);
  }
}
