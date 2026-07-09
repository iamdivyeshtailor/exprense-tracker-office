require('dotenv').config();
const express = require('express');
const session = require('express-session');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Import helper modules
const googleSheets = require('./googleSheets');
const scheduler = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'kd_purchases_default_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Configure Multer for local Invoice Uploads
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `${req.body.type || 'invoice'}_${uniqueSuffix}${ext}`);
  }
});
const upload = multer({ storage: storage });

// Path to our master local excel file
const EXCEL_FILE = path.join(__dirname, 'Master_IT_Purchases_and_Billing.xlsx');

// Check active mode
function getActiveMode() {
  const isGS = googleSheets.isSheetsConfigured();
  return isGS ? 'Google Sheets' : 'Local Excel';
}

// ----------------------------------------------------
// EXCELJS HELPERS (Local fallback)
// ----------------------------------------------------
function parseExcelDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'object' && value.result) {
    if (value.result instanceof Date) {
      return value.result.toISOString().split('T')[0];
    }
    return String(value.result);
  }
  if (typeof value === 'number') {
    const utc_days = Math.floor(value - 25569);
    const utc_value = utc_days * 86400;
    const d = new Date(utc_value * 1000);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  }
  return String(value);
}

function getCellValue(cell) {
  if (cell.value === null || cell.value === undefined) return '';
  if (typeof cell.value === 'object') {
    if ('result' in cell.value) {
      return cell.value.result !== null && cell.value.result !== undefined ? cell.value.result : '';
    }
    if ('richText' in cell.value) {
      return cell.value.richText.map(t => t.text).join('');
    }
    return '';
  }
  return cell.value;
}

// Load Local Excel Data
async function loadExcelData() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_FILE);

  const sheetsData = {};
  const tabsToLoad = [
    { key: 'purchases', name: 'IT Purchases' },
    { key: 'domains', name: 'Domains' },
    { key: 'servers', name: 'Server and Hosting' },
    { key: 'aiModels', name: 'AI and GPT Models' },
    { key: 'courses', name: 'Courses and Training' }
  ];

  tabsToLoad.forEach(tab => {
    const sheet = workbook.getWorksheet(tab.name);
    if (!sheet) {
      sheetsData[tab.key] = { headers: [], rows: [] };
      return;
    }

    const data = [];
    let headers = [];
    let headerRowNumber = 1;
    
    // Find headers
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const rowValues = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        rowValues.push(getCellValue(cell));
      });
      if (rowValues.some(v => v !== '')) {
        headers = rowValues;
        headerRowNumber = r;
        break;
      }
    }

    // Read remaining rows
    for (let r = headerRowNumber + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const rowValues = [];
      let hasData = false;
      
      for (let c = 1; c <= headers.length; c++) {
        const cell = row.getCell(c);
        const val = getCellValue(cell);
        rowValues.push(val);
        if (val !== '') hasData = true;
      }

      if (hasData) {
        const item = { _rowIndex: r };
        headers.forEach((header, index) => {
          if (header) {
            let val = rowValues[index];
            if (header.toLowerCase().includes('expiry') || header.toLowerCase().includes('date') || header.toLowerCase().includes('month')) {
              val = parseExcelDate(row.getCell(index + 1).value);
            }
            item[header] = val;
          }
        });
        data.push(item);
      }
    }
    
    sheetsData[tab.key] = {
      headers: headers.filter(Boolean),
      rows: data
    };
  });

  // Load Billing History
  const historySheet = workbook.getWorksheet('Monthly Billing History');
  if (historySheet) {
    const rows = [];
    let headers = [];
    const headerRow = historySheet.getRow(1);
    headerRow.eachCell({ includeEmpty: true }, (cell) => {
      headers.push(getCellValue(cell));
    });
    headers = headers.filter(Boolean);

    for (let r = 2; r <= historySheet.rowCount; r++) {
      const row = historySheet.getRow(r);
      const item = { _rowIndex: r };
      let hasData = false;
      
      headers.forEach((header, index) => {
        const val = getCellValue(row.getCell(index + 1));
        if (val !== '') hasData = true;
        item[header] = val;
      });

      if (hasData) {
        rows.push(item);
      }
    }

    sheetsData.billingHistory = { headers, rows };
  } else {
    sheetsData.billingHistory = { headers: [], rows: [] };
  }

  // Calculate local stats
  sheetsData.stats = calculateStats(sheetsData);
  return sheetsData;
}

// Calculate high-level metrics (same as google sheets version)
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

// Save Local Excel Row
async function saveExcelRow(type, rowIndex, data) {
  const tabMapping = {
    purchases: 'IT Purchases',
    domains: 'Domains',
    servers: 'Server and Hosting',
    aiModels: 'AI and GPT Models',
    courses: 'Courses and Training'
  };

  const sheetName = tabMapping[type];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_FILE);
  const sheet = workbook.getWorksheet(sheetName);

  if (!sheet) {
    throw new Error(`Worksheet ${sheetName} not found`);
  }

  // Get headers
  let headers = [];
  let headerRowNumber = 1;
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const rowValues = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      rowValues.push(getCellValue(cell));
    });
    if (rowValues.some(v => v !== '')) {
      headers = rowValues;
      headerRowNumber = r;
      break;
    }
  }

  // Add "Invoice File" dynamically if we have invoice data but it's not in headers yet
  if (data['Invoice File'] && !headers.includes('Invoice File')) {
    headers.push('Invoice File');
    sheet.getRow(headerRowNumber).getCell(headers.length).value = 'Invoice File';
    sheet.getRow(headerRowNumber).commit();
  }

  let targetRowNumber = rowIndex;
  let targetRow;

  if (targetRowNumber) {
    targetRow = sheet.getRow(targetRowNumber);
  } else {
    let lastRow = sheet.rowCount;
    while (lastRow > headerRowNumber) {
      const checkRow = sheet.getRow(lastRow);
      let hasContent = false;
      checkRow.eachCell((c) => {
        if (getCellValue(c) !== '') hasContent = true;
      });
      if (hasContent) break;
      lastRow--;
    }
    targetRowNumber = lastRow + 1;
    targetRow = sheet.getRow(targetRowNumber);
  }

  headers.forEach((header, index) => {
    if (header) {
      let value = data[header];
      const cell = targetRow.getCell(index + 1);
      
      if (header.toLowerCase().includes('expiry') || header.toLowerCase().includes('date')) {
        if (value) {
          cell.value = new Date(value);
        } else {
          cell.value = null;
        }
      } else if (header.toLowerCase() === 'cost' || header.toLowerCase() === 'price' || header.toLowerCase() === 'renewal price') {
        if (value !== undefined && value !== '') {
          const num = parseFloat(String(value).replace(/[^\d.-]/g, ''));
          cell.value = isNaN(num) ? value : num;
        } else {
          cell.value = null;
        }
      } else {
        cell.value = value !== undefined ? value : '';
      }
    }
  });

  targetRow.commit();
  await workbook.xlsx.writeFile(EXCEL_FILE);
  return targetRowNumber;
}

// Archive Local Excel Row
async function archiveExcelRow(type, rowIndex) {
  const tabMapping = {
    purchases: 'IT Purchases',
    domains: 'Domains',
    servers: 'Server and Hosting',
    aiModels: 'AI and GPT Models',
    courses: 'Courses and Training'
  };

  const sheetName = tabMapping[type];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_FILE);
  const sourceSheet = workbook.getWorksheet(sheetName);
  const archiveSheet = workbook.getWorksheet('Inactive Assets');

  if (!sourceSheet || !archiveSheet) {
    throw new Error('Sheets not found');
  }

  const sourceRow = sourceSheet.getRow(rowIndex);
  const rowValues = [];
  sourceRow.eachCell({ includeEmpty: true }, (cell) => {
    rowValues.push(getCellValue(cell));
  });

  if (rowValues.every(v => v === '')) {
    throw new Error('Row is empty');
  }

  // Append descriptive logging to Inactive Assets
  let lastRow = archiveSheet.rowCount;
  while (lastRow > 1) {
    const checkRow = archiveSheet.getRow(lastRow);
    let hasContent = false;
    checkRow.eachCell((c) => {
      if (getCellValue(c) !== '') hasContent = true;
    });
    if (hasContent) break;
    lastRow--;
  }
  const archiveRowNumber = lastRow + 1;
  const newArchiveRow = archiveSheet.getRow(archiveRowNumber);

  const dateStr = new Date().toISOString().split('T')[0];
  newArchiveRow.getCell(1).value = `Archived from ${sheetName} on ${dateStr}: ${rowValues.filter(Boolean).slice(0, 3).join(' | ')}`;
  newArchiveRow.commit();

  // Clear source cell entries
  sourceRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.value = null;
  });
  sourceRow.commit();

  await workbook.xlsx.writeFile(EXCEL_FILE);
}

// ----------------------------------------------------
// GENERIC DUAL-MODE API ROUTERS (Excel / Google Sheets)
// ----------------------------------------------------
async function getUnifiedData() {
  if (googleSheets.isSheetsConfigured()) {
    return await googleSheets.loadGoogleSheetsData();
  } else {
    return await loadExcelData();
  }
}

// ----------------------------------------------------
// ROUTING MIDDLEWARES & AUTHENTICATION
// ----------------------------------------------------
function requireLogin(req, res, next) {
  if (!req.session.loggedIn) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    return res.redirect('/login.html');
  }
  next();
}

// Auth endpoints
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  if (password === adminPassword) {
    req.session.loggedIn = true;
    res.json({ success: true });
  } else {
    res.json({ success: false, error: 'Invalid password. Please try again.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Protect UI index page
app.get('/index.html', requireLogin);
app.get('/', (req, res) => {
  if (!req.session.loggedIn) {
    return res.redirect('/login.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Expose Active Sync Status info
app.get('/api/status', (req, res) => {
  res.json({
    mode: getActiveMode(),
    emailConfigured: scheduler.isEmailConfigured(),
    loggedIn: !!req.session.loggedIn
  });
});

// Protect other API routes
app.use('/api', requireLogin);

// API: Get Unified Data
app.get('/api/data', async (req, res) => {
  try {
    const data = await getUnifiedData();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Upload Invoice File Endpoint
app.post('/api/upload', upload.single('invoiceFile'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    
    // Return relative URL path to retrieve file
    const fileUrlPath = `/uploads/${req.file.filename}`;
    res.json({ success: true, fileUrl: fileUrlPath });
  } catch (error) {
    console.error('Upload failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Save or Update Item
app.post('/api/save', async (req, res) => {
  const { type, rowIndex, data } = req.body;
  try {
    let savedIndex;
    if (googleSheets.isSheetsConfigured()) {
      savedIndex = await googleSheets.saveGoogleSheetsRow(type, rowIndex, data);
    } else {
      savedIndex = await saveExcelRow(type, rowIndex, data);
    }
    res.json({ success: true, message: 'Saved successfully', rowIndex: savedIndex });
  } catch (error) {
    console.error('Error saving row:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Archive Item
app.post('/api/archive', async (req, res) => {
  const { type, rowIndex } = req.body;
  try {
    if (googleSheets.isSheetsConfigured()) {
      await googleSheets.archiveGoogleSheetsRow(type, rowIndex);
    } else {
      await archiveExcelRow(type, rowIndex);
    }
    res.json({ success: true, message: 'Archived successfully' });
  } catch (error) {
    console.error('Error archiving:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Trigger Alert Test Manually
app.post('/api/test-notifications', async (req, res) => {
  try {
    console.log('[API] Triggering manual email notifications alert test...');
    const result = await scheduler.checkExpirationsAndNotify(getUnifiedData);
    res.json({ success: true, result });
  } catch (error) {
    console.error('Notification test failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve public static folder
app.use(express.static(path.join(__dirname, 'public')));

// Boot server
app.listen(PORT, () => {
  console.log(`KD Purchases Server running on http://localhost:${PORT}`);
  console.log(`Active Database Sync Mode: [${getActiveMode()}]`);
  
  // Initialize automatic notification scheduler (uses getUnifiedData loader)
  scheduler.startNotificationScheduler(getUnifiedData);
});
