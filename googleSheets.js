const { google } = require('@googleapis/sheets');
const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, process.env.GOOGLE_CREDENTIALS_PATH || 'google-credentials.json');

// Check if credentials and Sheet ID are available
function isSheetsConfigured() {
  return fs.existsSync(CREDENTIALS_PATH) && !!process.env.GOOGLE_SHEET_ID;
}

// Get Google Sheets API client
function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const tabMapping = {
  purchases: 'IT Purchases',
  domains: 'Domains',
  servers: 'Server and Hosting',
  aiModels: 'AI and GPT Models',
  courses: 'Courses and Training',
  billingHistory: 'Monthly Billing History',
  inactive: 'Inactive Assets'
};

const reverseTabMapping = {
  'IT Purchases': 'purchases',
  'Domains': 'domains',
  'Server and Hosting': 'servers',
  'AI and GPT Models': 'aiModels',
  'Courses and Training': 'courses'
};

// Helper: parse date format
function cleanDate(val) {
  if (!val) return '';
  return String(val).trim();
}

// Load all Sheets
async function loadGoogleSheetsData() {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  // Retrieve details of the sheets
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetNames = meta.data.sheets.map(s => s.properties.title);

  const sheetsData = {};

  // Load active tracking tabs
  for (const [key, sheetName] of Object.entries(tabMapping)) {
    if (!sheetNames.includes(sheetName)) {
      sheetsData[key] = { headers: [], rows: [] };
      continue;
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:Z`
    });

    const values = response.data.values || [];
    if (values.length === 0) {
      sheetsData[key] = { headers: [], rows: [] };
      continue;
    }

    const headers = values[0];
    const rows = [];

    for (let i = 1; i < values.length; i++) {
      const rowArr = values[i];
      let hasData = false;
      const item = { _rowIndex: i + 1 }; // 1-based row index in Google Sheet

      headers.forEach((header, colIndex) => {
        let val = rowArr[colIndex] !== undefined ? rowArr[colIndex] : '';
        if (val !== '') hasData = true;
        
        // Format dates
        if (header && (header.toLowerCase().includes('expiry') || header.toLowerCase().includes('date') || header.toLowerCase().includes('month'))) {
          val = cleanDate(val);
        }
        
        if (header) {
          item[header] = val;
        }
      });

      if (hasData) {
        rows.push(item);
      }
    }

    sheetsData[key] = {
      headers: headers.filter(Boolean),
      rows
    };
  }

  // Calculate high-level stats from the Google Sheets data
  sheetsData.stats = calculateStats(sheetsData);
  return sheetsData;
}

// Calculate high-level metrics (same as server.js Excel analyzer)
function calculateStats(data) {
  let totalCost = 0;
  let activeSubCount = 0;
  let domainsCount = 0;
  let serversCount = 0;
  let expiringSoonCount = 0;
  const now = new Date();
  const warningDays = 30;

  function parseCost(val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const clean = String(val).replace(/[^\d.-]/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
  }

  if (data.purchases && data.purchases.rows) {
    data.purchases.rows.forEach(row => {
      activeSubCount++;
      const cost = parseCost(row['Cost']);
      const license = String(row['License #'] || '').toLowerCase();
      if (license.includes('yearly') || license.includes('annual')) {
        totalCost += (cost / 12);
      } else {
        totalCost += cost;
      }

      if (row['Expiry']) {
        const expDate = new Date(row['Expiry']);
        if (!isNaN(expDate.getTime())) {
          const diffDays = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
          if (diffDays >= 0 && diffDays <= warningDays) expiringSoonCount++;
        }
      }
    });
  }

  if (data.domains && data.domains.rows) {
    domainsCount = data.domains.rows.length;
    data.domains.rows.forEach(row => {
      const cost = parseCost(row['Renewal Price'] || row['COST'] || 0);
      totalCost += (cost / 12);

      if (row['Expiry']) {
        const expDate = new Date(row['Expiry']);
        if (!isNaN(expDate.getTime())) {
          const diffDays = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
          if (diffDays >= 0 && diffDays <= warningDays) expiringSoonCount++;
        }
      }
    });
  }

  if (data.servers && data.servers.rows) {
    serversCount = data.servers.rows.length;
    data.servers.rows.forEach(row => {
      const cost = parseCost(row['Cost']);
      const license = String(row['License #'] || '').toLowerCase();
      if (license.includes('yearly')) {
        totalCost += (cost / 12);
      } else {
        totalCost += cost;
      }

      if (row['Expiry']) {
        const expDate = new Date(row['Expiry']);
        if (!isNaN(expDate.getTime())) {
          const diffDays = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
          if (diffDays >= 0 && diffDays <= warningDays) expiringSoonCount++;
        }
      }
    });
  }

  if (data.aiModels && data.aiModels.rows) {
    data.aiModels.rows.forEach(row => {
      const price = parseCost(row['PRICE']);
      const plan = String(row['Plan'] || '').toLowerCase();
      if (plan.includes('yearly')) {
        totalCost += (price / 12);
      } else {
        totalCost += price;
      }
    });
  }

  return {
    estMonthlySpend: Math.round(totalCost),
    activeSubCount,
    domainsCount,
    serversCount,
    expiringSoonCount
  };
}

// Save or Update Row
async function saveGoogleSheetsRow(type, rowIndex, data) {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = tabMapping[type];

  // Fetch current sheet to get headers structure
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:Z1`
  });
  
  const headers = (response.data.values && response.data.values[0]) || [];

  // Build row array matching header order
  const rowArray = headers.map(header => {
    return data[header] !== undefined && data[header] !== null ? String(data[header]) : '';
  });

  if (rowIndex) {
    // Edit existing row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A${rowIndex}:Z${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [rowArray] }
    });
    return rowIndex;
  } else {
    // Append new row
    const appendResponse = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:A`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [rowArray] }
    });
    
    // Parse the updated range to extract new row index
    const updatedRange = appendResponse.data.updates.updatedRange; // e.g. "IT Purchases!A25:H25"
    const match = updatedRange.match(/A(\d+):/);
    return match ? parseInt(match[1]) : null;
  }
}

// Archive Row
async function archiveGoogleSheetsRow(type, rowIndex) {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sourceSheet = tabMapping[type];
  const archiveSheet = 'Inactive Assets';

  // Read the source row to archive
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sourceSheet}!A${rowIndex}:Z${rowIndex}`
  });

  const rowValues = (response.data.values && response.data.values[0]) || [];
  if (rowValues.length === 0 || rowValues.every(v => v === '')) {
    throw new Error('Row is empty or not found');
  }

  // Create archive description line
  const dateStr = new Date().toISOString().split('T')[0];
  const logText = `Archived from ${sourceSheet} on ${dateStr}: ${rowValues.filter(Boolean).slice(0, 3).join(' | ')}`;

  // Append description to Inactive Assets
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${archiveSheet}!A:A`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[logText]] }
  });

  // Clear cells in the source row by replacing them with empty strings
  const emptyRow = rowValues.map(() => '');
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sourceSheet}!A${rowIndex}:Z${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [emptyRow] }
  });
}

module.exports = {
  isSheetsConfigured,
  loadGoogleSheetsData,
  saveGoogleSheetsRow,
  archiveGoogleSheetsRow
};
