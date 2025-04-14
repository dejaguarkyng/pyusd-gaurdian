import { getAlerts } from '../database/database.js';
import { sendEmail } from '../emailNotifier.js'; // your own email util
import dayjs from 'dayjs';

export async function generateDailyReport() {
  const startOfDay = dayjs().startOf('day').toDate();
  const endOfDay = dayjs().endOf('day').toDate();

  const alerts = await getAlerts({ from: startOfDay, to: endOfDay });

  const highSeverity = alerts.filter(alert => alert.riskReport?.severity === 'high');
  const medium = alerts.filter(alert => alert.riskReport?.severity === 'medium');
  const low = alerts.filter(alert => alert.riskReport?.severity === 'low');

  const report = `
    🛡️ PYUSD Guardian Daily Report

    Total Alerts: ${alerts.length}
    High Severity: ${highSeverity.length}
    Medium: ${medium.length}
    Low: ${low.length}

    Recent High-Risk Transactions:
    ${highSeverity.map(a => `- ${a.txHash} (${a.rule})`).join('\n')}
  `;

  await sendEmail({
    to: 'your-team@example.com',
    subject: 'Daily PYUSD Alert Summary',
    text: report
  });
}
