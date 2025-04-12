import { google } from 'googleapis';
import { config } from 'dotenv';
import fs from 'fs';

config();

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH, // JSON key file
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

export async function pushToSheet(alertData) {
  try {
    const values = [[
      new Date().toISOString(),
      alertData.txHash,
      alertData.rule,
      alertData.details,
      JSON.stringify(alertData.riskReport)
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Alerts!A1', // assumes there's a sheet named "Alerts"
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });

    console.log('📤 Alert pushed to Google Sheets!');
  } catch (err) {
    console.error('❌ Failed to push to Google Sheets:', err.message);
  }
}
