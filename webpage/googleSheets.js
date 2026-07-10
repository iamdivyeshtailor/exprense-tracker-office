const { auth, sheets } = require('@googleapis/sheets');
const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, process.env.GOOGLE_CREDENTIALS_PATH || 'google-credentials.json');

// Check if credentials and Sheet ID are available
function isSheetsConfigured() {
  return fs.existsSync(CREDENTIALS_PATH) && !!process.env.GOOGLE_SHEET_ID;
}

// Get Google Sheets API client
function getSheetsClient() {
  const authClient = new auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return sheets({ version: 'v4', auth: authClient });
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

// Helper to get all month headers from 2023-01 to the current calendar month
function getRequiredMonthHeaders() {
  const months = [];
  const d = new Date();
  const startYear = 2023;
  const startMonth = 1;
  const currentYear = d.getFullYear();
  const currentMonth = d.getMonth() + 1;

  let y = startYear;
  let m = startMonth;
  while (y < currentYear || (y === currentYear && m <= currentMonth)) {
    const mm = String(m).padStart(2, '0');
    months.push(`${y}-${mm}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

// Convert 1-based column index to Excel column letter (e.g. 1 -> A, 27 -> AA)
function getColLetter(index) {
  let temp = index;
  let letter = '';
  while (temp > 0) {
    let temp2 = (temp - 1) % 26;
    letter = String.fromCharCode(65 + temp2) + letter;
    temp = parseInt((temp - temp2) / 26);
  }
  return letter;
}

// Helper to fill down blank cells (inheriting values from row above for grouped items)
function fillDownGroupedRows(rows, headers) {
  const fillDownHeaders = [
    'billing name', 'platform', 'platform - plan', 
    'url to login', 'link', 'url', 'url to login ',
    'id', 'username', 'user', 
    'pwd', 'password', 
    'asset name', 'billing cycle'
  ];

  const lastValues = {};
  
  rows.forEach(row => {
    headers.forEach(h => {
      if (!h) return;
      const hLower = h.toLowerCase().trim();
      if (fillDownHeaders.includes(hLower)) {
        const val = row[h];
        if (val !== undefined && val !== null && String(val).trim() !== '' && String(val).trim() !== '—' && String(val).trim() !== '-') {
          lastValues[h] = val;
        } else {
          if (lastValues[h] !== undefined) {
            row[h] = lastValues[h];
          }
        }
      }
    });
  });
}

// Helper to seed a sheet tab from local Excel template if it's missing online
async function seedSheetFromExcel(sheets, spreadsheetId, sheetName) {
  try {
    const ExcelJS = require('exceljs');
    const EXCEL_FILE = path.join(__dirname, '..', 'Master_IT_Purchases_and_Billing.xlsx');
    if (!fs.existsSync(EXCEL_FILE)) return;

    // 1. Create the sheet online
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }]
      }
    });

    // 2. Read local excel worksheet data
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(EXCEL_FILE);
    const localSheet = workbook.getWorksheet(sheetName);
    if (!localSheet) return;

    const uploadValues = [];
    for (let r = 1; r <= localSheet.rowCount; r++) {
      const row = localSheet.getRow(r);
      const rowValues = [];
      const maxCol = Math.max(row.cellCount, 26);
      for (let c = 1; c <= maxCol; c++) {
        const cell = row.getCell(c);
        let cellVal = cell.value;
        if (cellVal && typeof cellVal === 'object') {
          if (cellVal.result !== undefined) cellVal = cellVal.result;
          else if (cellVal.richText) cellVal = cellVal.richText.map(t => t.text).join('');
          else if (cellVal.text) cellVal = cellVal.text;
          else if (cellVal instanceof Date) cellVal = cellVal.toISOString().split('T')[0];
          else cellVal = JSON.stringify(cellVal);
        }
        rowValues.push(cellVal !== undefined && cellVal !== null ? String(cellVal) : '');
      }
      if (rowValues.some(v => v !== '')) {
        uploadValues.push(rowValues);
      }
    }

    if (uploadValues.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: uploadValues }
      });
      console.log(`[Google Sheets] Seeded missing tab: "${sheetName}" from local Excel template.`);
    }
  } catch (err) {
    console.error(`[Google Sheets] Failed to seed missing tab "${sheetName}":`, err.message);
  }
}

// Load all Sheets
async function loadGoogleSheetsData() {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  // Retrieve details of the sheets
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  let sheetNames = meta.data.sheets.map(s => s.properties.title);

  const sheetsData = {};

  // Load active tracking tabs
  for (const [key, sheetName] of Object.entries(tabMapping)) {
    if (!sheetNames.includes(sheetName)) {
      await seedSheetFromExcel(sheets, spreadsheetId, sheetName);
      
      // Re-fetch sheet metadata to include new sheet
      const updatedMeta = await sheets.spreadsheets.get({ spreadsheetId });
      sheetNames = updatedMeta.data.sheets.map(s => s.properties.title);
      
      if (!sheetNames.includes(sheetName)) {
        sheetsData[key] = { headers: [], rows: [] };
        continue;
      }
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:ZZ`
    });

    const values = response.data.values || [];
    if (values.length === 0) {
      sheetsData[key] = { headers: [], rows: [] };
      continue;
    }

    const headers = values[0];
    
    // Auto-expand headers for billing history to match calendar months up to today
    if (key === 'billingHistory') {
      const requiredMonths = getRequiredMonthHeaders();
      let modified = false;
      requiredMonths.forEach(m => {
        if (!headers.includes(m)) {
          headers.push(m);
          modified = true;
        }
      });
      if (modified) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A1:${getColLetter(headers.length)}1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [headers] }
        });
        console.log(`[Google Sheets] Automatically expanded Monthly Billing History headers up to current month.`);
      }
    }
    
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

    if (key !== 'billingHistory') {
      fillDownGroupedRows(rows, headers);
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

  function parseCostToINR(val) {
    if (!val) return 0;
    const str = String(val).trim();
    const clean = str.replace(/[^\d.-]/g, '');
    const num = parseFloat(clean);
    if (isNaN(num)) return 0;
    
    if (str.includes('A$')) {
      return num * 55; // AUD to INR
    } else if (str.includes('$')) {
      return num * 83; // USD to INR
    } else if (str.includes('€')) {
      return num * 90; // EUR to INR
    }
    return num;
  }

  if (data.purchases && data.purchases.rows) {
    data.purchases.rows.forEach(row => {
      activeSubCount++;
      const cost = parseCostToINR(row['Cost']);
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
      const cost = parseCostToINR(row['Renewal Price'] || row['COST'] || 0);
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
      const cost = parseCostToINR(row['Cost']);
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
      const price = parseCostToINR(row['PRICE']);
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
    range: `${sheetName}!A1:ZZ1`
  });
  
  let headers = (response.data.values && response.data.values[0]) || [];

  // Check if 'Invoice File' is in the spreadsheet headers. If not, append it, update headers on Google Sheets, and reload.
  if (!headers.includes('Invoice File')) {
    headers.push('Invoice File');
    const colLetter = getColLetter(headers.length);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:${colLetter}1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] }
    });
    
    // Reload headers
    const reloadResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:${colLetter}1`
    });
    headers = (reloadResponse.data.values && reloadResponse.data.values[0]) || [];
  }

  // Build row array matching header order
  const rowArray = headers.map(header => {
    return data[header] !== undefined && data[header] !== null ? String(data[header]) : '';
  });

  if (rowIndex) {
    // Edit existing row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A${rowIndex}:${getColLetter(headers.length)}${rowIndex}`,
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
    range: `${sourceSheet}!A${rowIndex}:ZZ${rowIndex}`
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
    range: `${sourceSheet}!A${rowIndex}:${getColLetter(rowValues.length)}${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [emptyRow] }
  });
}

// Delete Google Sheets Row (splices row out and shifts others up)
async function deleteGoogleSheetsRow(type, rowIndex) {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = tabMapping[type];

  // Get sheetId for the given sheet name
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets.find(s => s.properties.title === sheetName);
  if (!sheet) {
    throw new Error(`Sheet ${sheetName} not found`);
  }
  const googleSheetId = sheet.properties.sheetId;

  // Send request to delete the row
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: googleSheetId,
              dimension: 'ROWS',
              startIndex: rowIndex - 1, // 0-based
              endIndex: rowIndex
            }
          }
        }
      ]
    }
  });
}

module.exports = {
  isSheetsConfigured,
  loadGoogleSheetsData,
  saveGoogleSheetsRow,
  archiveGoogleSheetsRow,
  deleteGoogleSheetsRow
};
