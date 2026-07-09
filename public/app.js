// Global State
let appData = null;
let activeTab = 'dashboard';
let systemStatus = {};

// DOM Elements
const navLinks = document.querySelectorAll('.nav-link');
const tabDashboard = document.getElementById('tab-dashboard');
const tabData = document.getElementById('tab-data');
const tabBillingHistory = document.getElementById('tab-billingHistory');
const pageTitle = document.getElementById('page-title');
const pageSubtitle = document.getElementById('page-subtitle');
const addBtn = document.getElementById('add-btn');
const refreshBtn = document.getElementById('refresh-btn');
const testNotifBtn = document.getElementById('test-notif-btn');
const logoutBtn = document.getElementById('logout-btn');

// Search & Filters
const tableSearchInput = document.getElementById('table-search');
const filterExpirySelect = document.getElementById('filter-expiry');
const filterProviderSelect = document.getElementById('filter-provider');
const billingSearchInput = document.getElementById('billing-search');
const filterBillingProviderSelect = document.getElementById('filter-billing-provider');

// Modal Elements
const formModal = document.getElementById('form-modal');
const modalTitle = document.getElementById('modal-title');
const modalClose = document.getElementById('modal-close');
const modalCancel = document.getElementById('modal-cancel');
const purchaseForm = document.getElementById('purchase-form');
const modalFormFields = document.getElementById('modal-form-fields');

// Invoice upload controls
const invoiceUploadInput = document.getElementById('invoice-upload-input');
const triggerUploadBtn = document.getElementById('trigger-upload-btn');
const uploadFilenameLabel = document.getElementById('upload-filename-label');
const uploadProgressContainer = document.getElementById('upload-progress-container');
const uploadProgressBar = document.getElementById('upload-progress-bar');
const invoiceFilePathHidden = document.getElementById('invoice-file-path-hidden');

let currentEditingRowIndex = null;

// Init Application
document.addEventListener('DOMContentLoaded', async () => {
  const authOk = await checkAuthStatus();
  if (authOk) {
    fetchData();
    setupEventListeners();
  }
});

// Check Session Authentication Status
async function checkAuthStatus() {
  try {
    const res = await fetch('/api/status');
    if (res.status === 401) {
      window.location.href = '/login.html';
      return false;
    }
    const status = await res.json();
    systemStatus = status;
    
    // Update Sync Mode visual
    document.getElementById('sync-mode').textContent = status.mode;
    return true;
  } catch (e) {
    window.location.href = '/login.html';
    return false;
  }
}

// Setup Event Listeners
function setupEventListeners() {
  // Sidebar tab switching
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      
      const tab = link.getAttribute('data-tab');
      switchTab(tab);
    });
  });

  // Action Buttons
  refreshBtn.addEventListener('click', () => {
    fetchData();
    showToast('Synced data with database', 'success');
  });

  testNotifBtn.addEventListener('click', async () => {
    showToast('Checking expiries and sending email report...', 'success');
    try {
      const res = await fetch('/api/test-notifications', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        if (result.result.count > 0) {
          showToast(`Alert check finished: sent mail for ${result.result.count} items!`, 'success');
        } else {
          showToast('Alert check finished: No items expire in 7 days. Email skipped.', 'success');
        }
      } else {
        showToast('Notification test failed: ' + result.error, 'error');
      }
    } catch (e) {
      showToast('Error testing email alerts setup.', 'error');
    }
  });

  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/login.html';
    } catch (e) {
      showToast('Failed to log out cleanly.', 'error');
    }
  });

  addBtn.addEventListener('click', () => {
    openModal(null);
  });

  // Search & Filter events
  tableSearchInput.addEventListener('input', filterAndRenderActiveTable);
  filterExpirySelect.addEventListener('change', filterAndRenderActiveTable);
  filterProviderSelect.addEventListener('change', filterAndRenderActiveTable);
  
  billingSearchInput.addEventListener('input', renderBillingHistoryTable);
  filterBillingProviderSelect.addEventListener('change', renderBillingHistoryTable);

  // Modal events
  modalClose.addEventListener('click', closeModal);
  modalCancel.addEventListener('click', closeModal);
  purchaseForm.addEventListener('submit', handleFormSubmit);

  // Trigger file upload click
  triggerUploadBtn.addEventListener('click', () => {
    invoiceUploadInput.click();
  });

  invoiceUploadInput.addEventListener('change', handleInvoiceFileUpload);

  // Close modal when clicking background
  formModal.addEventListener('click', (e) => {
    if (e.target === formModal) closeModal();
  });

  // Responsive chart resizing
  window.addEventListener('resize', () => {
    if (activeTab === 'dashboard') {
      renderSpendChart();
    }
  });
}

// Switch Tabs UI and state
function switchTab(tab) {
  activeTab = tab;
  
  // Reset search inputs
  tableSearchInput.value = '';
  filterExpirySelect.value = '';
  filterProviderSelect.value = '';
  billingSearchInput.value = '';
  filterBillingProviderSelect.value = '';

  if (tab === 'dashboard') {
    tabDashboard.classList.add('active');
    tabData.classList.remove('active');
    tabBillingHistory.classList.remove('active');
    pageTitle.textContent = 'Executive Dashboard';
    pageSubtitle.textContent = 'Consolidated view of IT investments, hosting, and billing history.';
    addBtn.style.display = 'none';
    renderSpendChart();
  } else if (tab === 'billingHistory') {
    tabDashboard.classList.remove('active');
    tabData.classList.remove('active');
    tabBillingHistory.classList.add('active');
    pageTitle.textContent = 'Monthly Billing History';
    pageSubtitle.textContent = 'Historical breakdown of monthly invoices and tool costs.';
    addBtn.style.display = 'none';
    populateProviderFilters();
    renderBillingHistoryTable();
  } else {
    tabDashboard.classList.remove('active');
    tabData.classList.add('active');
    tabBillingHistory.classList.remove('active');
    addBtn.style.display = 'inline-flex';
    
    const titles = {
      purchases: 'IT Purchases & Licenses',
      domains: 'Domain Inventory',
      servers: 'Server & Hosting Details',
      aiModels: 'AI & GPT Model Subscriptions',
      courses: 'Courses and Training'
    };
    pageTitle.textContent = titles[tab] || 'IT Purchases';
    pageSubtitle.textContent = `Manage and view items under the ${titles[tab] || tab} sheet.`;
    
    populateProviderFilters();
    filterAndRenderActiveTable();
  }
}

// Fetch Data from Server
async function fetchData() {
  try {
    const response = await fetch('/api/data');
    if (response.status === 401) {
      window.location.href = '/login.html';
      return;
    }
    const result = await response.json();
    if (result.success) {
      appData = result.data;
      updateDashboardMetrics();
      renderUpcomingExpirations();
      renderSpendChart();
      
      populateProviderFilters();

      if (activeTab !== 'dashboard' && activeTab !== 'billingHistory') {
        filterAndRenderActiveTable();
      } else if (activeTab === 'billingHistory') {
        renderBillingHistoryTable();
      }
    } else {
      showToast('Error syncing: ' + result.error, 'error');
    }
  } catch (error) {
    showToast('Failed to connect to backend server', 'error');
  }
}

// Update Dashboard Cards
function updateDashboardMetrics() {
  if (!appData || !appData.stats) return;
  const stats = appData.stats;
  
  document.getElementById('stat-spend').textContent = '₹ ' + stats.estMonthlySpend.toLocaleString('en-IN');
  document.getElementById('stat-subs').textContent = stats.activeSubCount;
  document.getElementById('stat-domains').textContent = stats.domainsCount;
  document.getElementById('stat-alerts').textContent = stats.expiringSoonCount;

  const alertVal = document.getElementById('stat-alerts');
  if (stats.expiringSoonCount > 0) {
    alertVal.className = 'metric-value text-danger';
  } else {
    alertVal.className = 'metric-value';
  }
}

// Gather unique providers dynamically to fill filter select boxes
function populateProviderFilters() {
  if (!appData) return;

  const currentSelect = activeTab === 'billingHistory' ? filterBillingProviderSelect : filterProviderSelect;
  if (!currentSelect) return;

  // Clear previous options except first
  currentSelect.innerHTML = `<option value="">All Providers / Tools</option>`;

  const providers = new Set();

  if (activeTab === 'billingHistory') {
    if (appData.billingHistory && appData.billingHistory.rows) {
      appData.billingHistory.rows.forEach(row => {
        const item = row['Item Name'] || row['Category'];
        if (item) {
          // get the first word or name
          const prov = String(item).split(' ')[0].split('(')[0].trim();
          providers.add(prov);
        }
      });
    }
  } else {
    const sheetData = appData[activeTab];
    if (sheetData && sheetData.rows) {
      sheetData.rows.forEach(row => {
        const nameField = row['Tool Name'] || row['Domain Name'] || row['Server Name'] || row['AI MODEL'] || row['Platform'] || '';
        if (nameField) {
          const prov = String(nameField).split(' ')[0].trim();
          providers.add(prov);
        }
      });
    }
  }

  // Sort and append
  Array.from(providers).sort().forEach(p => {
    if (p && p.length > 1) {
      const opt = document.createElement('option');
      opt.value = p.toLowerCase();
      opt.textContent = p;
      currentSelect.appendChild(opt);
    }
  });
}

// Custom 100% Responsive SVG Line Chart (0% external libraries)
function renderSpendChart() {
  const container = document.getElementById('svg-chart-container');
  container.innerHTML = '';

  if (!appData || !appData.billingHistory) return;

  const history = appData.billingHistory;
  const monthHeaders = history.headers.filter(h => /^\d{4}-\d{2}$/.test(h)).sort().slice(-12);
  
  if (monthHeaders.length === 0) {
    container.innerHTML = '<p class="no-data">No billing history found.</p>';
    return;
  }

  // Calculate monthly totals
  const monthlyTotals = monthHeaders.map(month => {
    let total = 0;
    history.rows.forEach(row => {
      const val = row[month];
      if (val !== undefined && val !== null && val !== '') {
        const clean = String(val).replace(/[^\d.-]/g, '');
        const num = parseFloat(clean);
        if (!isNaN(num)) total += num;
      }
    });
    return Math.round(total);
  });

  const maxVal = Math.max(...monthlyTotals, 10000) * 1.1; // 10% spacing top
  const minVal = 0;

  // Render SVG chart viewport
  const svgWidth = container.offsetWidth || 500;
  const svgHeight = 250;
  const paddingLeft = 65;
  const paddingRight = 20;
  const paddingTop = 25;
  const paddingBottom = 35;

  const plotWidth = svgWidth - paddingLeft - paddingRight;
  const plotHeight = svgHeight - paddingTop - paddingBottom;

  let points = [];
  monthHeaders.forEach((month, idx) => {
    const x = paddingLeft + (idx / (monthHeaders.length - 1)) * plotWidth;
    const y = paddingTop + plotHeight - ((monthlyTotals[idx] - minVal) / (maxVal - minVal)) * plotHeight;
    points.push({ x, y, month, total: monthlyTotals[idx] });
  });

  // Build grid lines, axis text, gradients and paths
  let gridLines = '';
  // Horizontal grid lines
  const ticksCount = 4;
  for (let i = 0; i <= ticksCount; i++) {
    const gridY = paddingTop + (i / ticksCount) * plotHeight;
    const tickVal = Math.round(maxVal - (i / ticksCount) * (maxVal - minVal));
    gridLines += `
      <line x1="${paddingLeft}" y1="${gridY}" x2="${svgWidth - paddingRight}" y2="${gridY}" class="chart-grid-line" />
      <text x="${paddingLeft - 10}" y="${gridY + 4}" class="chart-axis-text" text-anchor="end">₹${Math.round(tickVal / 1000)}k</text>
    `;
  }

  // Vertical grid lines & labels (X axis)
  let xLabels = '';
  points.forEach((pt, idx) => {
    // Show alternate labels if there are too many months
    if (points.length < 12 || idx % 2 === 0 || idx === points.length - 1) {
      xLabels += `
        <line x1="${pt.x}" y1="${paddingTop}" x2="${pt.x}" y2="${paddingTop + plotHeight}" class="chart-grid-line" />
        <text x="${pt.x}" y="${paddingTop + plotHeight + 18}" class="chart-axis-text" text-anchor="middle">${pt.month}</text>
      `;
    }
  });

  // Construct SVG Path string
  let pathStr = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    pathStr += ` L ${points[i].x} ${points[i].y}`;
  }

  // Construct Fill Path string (closes at the bottom)
  const fillPathStr = `${pathStr} L ${points[points.length - 1].x} ${paddingTop + plotHeight} L ${points[0].x} ${paddingTop + plotHeight} Z`;

  // Draw interactive dots and hidden tooltips
  let pointsElements = '';
  points.forEach((pt, idx) => {
    pointsElements += `
      <g class="chart-point-group">
        <circle cx="${pt.x}" cy="${pt.y}" r="4.5" class="chart-point" data-idx="${idx}" />
        <!-- Tooltip box (hidden by CSS/JS interactions or hovered elements) -->
        <g class="chart-tooltip" id="tooltip-${idx}" style="opacity: 0; pointer-events: none; transition: opacity 0.15s ease;">
          <rect x="${pt.x - 55}" y="${pt.y - 35}" width="110" height="24" class="chart-tooltip-bg" />
          <text x="${pt.x}" y="${pt.y - 19}" class="chart-tooltip-text">₹${pt.total.toLocaleString('en-IN')}</text>
        </g>
      </g>
    `;
  });

  const svgContent = `
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" class="chart-svg">
      <defs>
        <linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent-primary)" stop-opacity="0.4"/>
          <stop offset="100%" stop-color="var(--accent-primary)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      
      <!-- Grid -->
      ${gridLines}
      ${xLabels}
      
      <!-- Axis Lines -->
      <line x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${paddingTop + plotHeight}" class="chart-axis-line" />
      <line x1="${paddingLeft}" y1="${paddingTop + plotHeight}" x2="${svgWidth - paddingRight}" y2="${paddingTop + plotHeight}" class="chart-axis-line" />
      
      <!-- Area Fill -->
      <path d="${fillPathStr}" class="chart-area-fill" />
      
      <!-- Line Path -->
      <path d="${pathStr}" class="chart-line" />
      
      <!-- Dots & Tooltips -->
      ${pointsElements}
    </svg>
  `;

  container.innerHTML = svgContent;

  // Bind tooltip hover events
  const pointGroups = container.querySelectorAll('.chart-point-group');
  pointGroups.forEach(group => {
    const circle = group.querySelector('.chart-point');
    const tooltip = group.querySelector('.chart-tooltip');
    
    circle.addEventListener('mouseenter', () => {
      tooltip.style.opacity = '1';
    });
    
    circle.addEventListener('mouseleave', () => {
      tooltip.style.opacity = '0';
    });
  });
}

// Render Expirations lists
function renderUpcomingExpirations() {
  const container = document.getElementById('upcoming-list');
  container.innerHTML = '';

  if (!appData) return;

  const warningDays = 30;
  const now = new Date();
  const list = [];

  const types = ['purchases', 'domains', 'servers'];
  types.forEach(type => {
    const sheetData = appData[type];
    if (!sheetData || !sheetData.rows) return;

    sheetData.rows.forEach(row => {
      if (row['Expiry']) {
        const expDate = new Date(row['Expiry']);
        if (!isNaN(expDate.getTime())) {
          const diffDays = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
          
          if (diffDays <= warningDays) {
            let name = row['Tool Name'] || row['Domain Name'] || row['Server Name'] || 'Asset';
            list.push({
              name,
              type: type === 'purchases' ? 'Tool' : type === 'domains' ? 'Domain' : 'Server',
              expiry: row['Expiry'],
              daysLeft: diffDays
            });
          }
        }
      }
    });
  });

  list.sort((a, b) => a.daysLeft - b.daysLeft);

  if (list.length === 0) {
    container.innerHTML = '<p class="no-data">No items expiring soon.</p>';
    return;
  }

  list.forEach(item => {
    const div = document.createElement('div');
    const isExpired = item.daysLeft < 0;
    div.className = `upcoming-item ${isExpired ? 'expired' : 'warning'}`;
    
    div.innerHTML = `
      <div class="exp-details">
        <h4>${item.name}</h4>
        <span>${item.type}</span>
      </div>
      <div class="exp-date">
        <div class="days-left ${isExpired ? 'text-danger' : 'text-warning'}">
          ${isExpired ? 'Expired' : `${item.daysLeft} days left`}
        </div>
        <div class="date-label">${item.expiry}</div>
      </div>
    `;
    container.appendChild(div);
  });
}

// Filter and Render dynamic active tables
function filterAndRenderActiveTable() {
  if (!appData || !appData[activeTab]) return;

  const sheetData = appData[activeTab];
  const searchQuery = tableSearchInput.value.toLowerCase().trim();
  const filterExpiry = filterExpirySelect.value;
  const filterProvider = filterProviderSelect.value;
  const now = new Date();

  const filteredRows = sheetData.rows.filter(row => {
    // 1. Search Query filter
    let matchesSearch = !searchQuery;
    if (searchQuery) {
      for (let key in row) {
        if (key.startsWith('_')) continue;
        if (String(row[key]).toLowerCase().includes(searchQuery)) {
          matchesSearch = true;
          break;
        }
      }
    }

    // 2. Expiry filter
    let matchesExpiry = true;
    if (filterExpiry && row['Expiry']) {
      const expDate = new Date(row['Expiry']);
      if (!isNaN(expDate.getTime())) {
        const diffDays = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
        if (filterExpiry === 'expired') {
          matchesExpiry = diffDays < 0;
        } else if (filterExpiry === 'expiring-30') {
          matchesExpiry = diffDays >= 0 && diffDays <= 30;
        }
      } else {
        matchesExpiry = false;
      }
    } else if (filterExpiry) {
      matchesExpiry = false;
    }

    // 3. Provider filter
    let matchesProvider = !filterProvider;
    if (filterProvider) {
      const nameField = row['Tool Name'] || row['Domain Name'] || row['Server Name'] || row['AI MODEL'] || row['Platform'] || '';
      if (nameField && String(nameField).toLowerCase().startsWith(filterProvider)) {
        matchesProvider = true;
      }
    }

    return matchesSearch && matchesExpiry && matchesProvider;
  });

  const table = document.getElementById('data-table');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');

  thead.innerHTML = '';
  tbody.innerHTML = '';

  // Render headers
  const headerRow = document.createElement('tr');
  sheetData.headers.forEach(header => {
    const th = document.createElement('th');
    th.textContent = header;
    headerRow.appendChild(th);
  });
  const thActions = document.createElement('th');
  thActions.textContent = 'Actions';
  headerRow.appendChild(thActions);
  thead.appendChild(headerRow);

  if (filteredRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${sheetData.headers.length + 1}" class="no-data">No matching records found.</td></tr>`;
    return;
  }

  // Render rows
  filteredRows.forEach(row => {
    const tr = document.createElement('tr');
    
    sheetData.headers.forEach(header => {
      const td = document.createElement('td');
      const val = row[header] !== undefined && row[header] !== null ? row[header] : '';
      const headerLower = header.toLowerCase();
      
      // Render Credentials with show/hide toggle
      if (headerLower === 'pwd' || headerLower === 'password') {
        td.innerHTML = `
          <div class="credential-cell">
            <span class="credential-text" data-password="${val}">••••••••</span>
            <button class="credential-btn toggle-pwd-btn">
              <svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
            </button>
          </div>
        `;
        td.querySelector('.toggle-pwd-btn').addEventListener('click', togglePasswordVisibility);
      } else if (headerLower === 'id' || headerLower === 'username') {
        td.textContent = val;
      } else if (headerLower.includes('expiry') && val) {
        const expDate = new Date(val);
        if (!isNaN(expDate.getTime())) {
          const diffDays = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
          if (diffDays < 0) {
            td.innerHTML = `<span class="badge badge-danger" title="Expired on ${val}">${val}</span>`;
          } else if (diffDays <= 30) {
            td.innerHTML = `<span class="badge badge-warning" title="Expiring in ${diffDays} days">${val}</span>`;
          } else {
            td.innerHTML = `<span class="badge badge-success">${val}</span>`;
          }
        } else {
          td.textContent = val;
        }
      } else if (headerLower === 'url to login' || headerLower === 'link') {
        if (val) {
          td.innerHTML = `<a href="${val}" target="_blank" class="badge badge-default" style="text-decoration:none;">Login</a>`;
        } else {
          td.textContent = '';
        }
      } else if (headerLower === 'cost' || headerLower === 'price' || headerLower === 'renewal price') {
        if (val !== '') {
          const num = parseFloat(String(val).replace(/[^\d.-]/g, ''));
          td.textContent = !isNaN(num) ? '₹' + num.toLocaleString('en-IN') : val;
          td.className = 'cell-primary';
        } else {
          td.textContent = '—';
        }
      } else if (headerLower === 'invoice file') {
        // Download Invoice Button
        if (val) {
          td.innerHTML = `
            <button class="action-btn action-download" data-url="${val}" title="Download Receipt">
              <svg viewBox="0 0 24 24" width="16" height="16"><path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/></svg>
            </button>
          `;
          td.querySelector('.action-download').addEventListener('click', (e) => {
            window.open(e.currentTarget.getAttribute('data-url'), '_blank');
          });
        } else {
          td.textContent = '—';
        }
      } else if (header === 'Tool Name' || header === 'Domain Name' || header === 'Server Name' || header === 'AI MODEL') {
        td.textContent = val;
        td.className = 'cell-primary';
      } else {
        td.textContent = val;
      }
      
      tr.appendChild(td);
    });

    // Actions cell
    const tdActions = document.createElement('td');
    tdActions.className = 'cell-actions';
    tdActions.innerHTML = `
      <button class="action-btn action-edit" title="Edit row">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
      </button>
      <button class="action-btn action-delete" title="Delete row">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
      </button>
    `;
    
    tdActions.querySelector('.action-edit').addEventListener('click', () => openModal(row));
    tdActions.querySelector('.action-delete').addEventListener('click', () => confirmDelete(row._rowIndex));
    
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });
}

// Render Billing History Grid
function renderBillingHistoryTable() {
  if (!appData || !appData.billingHistory) return;

  const history = appData.billingHistory;
  const searchQuery = billingSearchInput.value.toLowerCase().trim();
  const filterProvider = filterBillingProviderSelect.value;

  const filteredRows = history.rows.filter(row => {
    // 1. Search Query filter
    let matchesSearch = !searchQuery;
    if (searchQuery) {
      matchesSearch = String(row['Category'] || '').toLowerCase().includes(searchQuery) ||
                      String(row['Item Name'] || '').toLowerCase().includes(searchQuery) ||
                      String(row['Details'] || '').toLowerCase().includes(searchQuery);
    }

    // 2. Provider/DigitalOcean filter
    let matchesProvider = !filterProvider;
    if (filterProvider) {
      const item = row['Item Name'] || row['Category'] || '';
      if (item && String(item).toLowerCase().startsWith(filterProvider)) {
        matchesProvider = true;
      }
    }

    return matchesSearch && matchesProvider;
  });

  const table = document.getElementById('billing-table');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');

  thead.innerHTML = '';
  tbody.innerHTML = '';

  // Render headers
  const headerRow = document.createElement('tr');
  history.headers.forEach(header => {
    const th = document.createElement('th');
    th.textContent = header;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  if (filteredRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${history.headers.length}" class="no-data">No matching records found.</td></tr>`;
    return;
  }

  // Render rows
  filteredRows.forEach(row => {
    const tr = document.createElement('tr');
    history.headers.forEach(header => {
      const td = document.createElement('td');
      const val = row[header] !== undefined && row[header] !== null ? row[header] : '';
      
      if (header === 'Category' || header === 'Item Name') {
        td.textContent = val;
        td.className = 'cell-primary';
      } else if (header === 'Details') {
        td.textContent = val;
        td.style.maxWidth = '250px';
        td.style.overflow = 'hidden';
        td.style.textOverflow = 'ellipsis';
        td.style.whiteSpace = 'nowrap';
        td.title = val;
      } else if (/^\d{4}-\d{2}$/.test(header)) {
        const num = parseFloat(String(val).replace(/[^\d.-]/g, ''));
        if (!isNaN(num) && num > 0) {
          td.textContent = '₹' + num.toLocaleString('en-IN');
          td.className = 'cell-primary';
        } else if (num === 0 || val === 0) {
          td.textContent = '—';
          td.style.color = 'var(--text-muted)';
        } else {
          td.textContent = val;
        }
      } else {
        td.textContent = val;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

// Credentials show/hide logic
function togglePasswordVisibility(e) {
  const btn = e.currentTarget;
  const span = btn.previousElementSibling;
  const isHidden = span.textContent === '••••••••';
  const realPassword = span.getAttribute('data-password');

  if (isHidden) {
    span.textContent = realPassword || '—';
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.82l2.92 2.92c1.63-1.44 2.78-3.4 3.44-5.74-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7z"/></svg>`;
  } else {
    span.textContent = '••••••••';
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;
  }
}

function toggleUserVisibility(e) {
  const btn = e.currentTarget;
  const span = btn.previousElementSibling;
  const realUser = span.getAttribute('data-user');
  const isHidden = btn.querySelector('svg').outerHTML.includes('7c2.76'); // check icon

  if (!isHidden) {
    span.textContent = realUser || '—';
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;
  } else {
    span.textContent = realUser ? realUser.substring(0, 15) + (realUser.length > 15 ? '...' : '') : '';
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.82l2.92 2.92c1.63-1.44 2.78-3.4 3.44-5.74-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7z"/></svg>`;
  }
}

// File Upload Handler (AJAX)
async function handleInvoiceFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  uploadFilenameLabel.textContent = file.name;
  uploadProgressContainer.style.display = 'block';
  uploadProgressBar.style.width = '0%';

  const formData = new FormData();
  formData.append('invoiceFile', file);
  formData.append('type', activeTab);

  // Simulated progress loader
  let progress = 0;
  const interval = setInterval(() => {
    progress += Math.random() * 20;
    if (progress > 85) {
      clearInterval(interval);
    } else {
      uploadProgressBar.style.width = `${Math.round(progress)}%`;
    }
  }, 100);

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    
    clearInterval(interval);
    uploadProgressBar.style.width = '100%';
    
    const result = await res.json();
    if (result.success) {
      invoiceFilePathHidden.value = result.fileUrl;
      showToast('Invoice uploaded successfully!', 'success');
      uploadFilenameLabel.textContent = `${file.name} (Uploaded)`;
    } else {
      showToast('Upload failed: ' + result.error, 'error');
      resetUploadArea();
    }
  } catch (err) {
    clearInterval(interval);
    showToast('Network error uploading file.', 'error');
    resetUploadArea();
  }
}

function resetUploadArea() {
  uploadProgressContainer.style.display = 'none';
  uploadProgressBar.style.width = '0%';
  invoiceUploadInput.value = '';
  invoiceFilePathHidden.value = '';
  uploadFilenameLabel.textContent = 'No file selected';
}

// Open Form Modal (Add & Edit)
function openModal(row = null) {
  if (!appData || !appData[activeTab]) return;

  const sheetData = appData[activeTab];
  currentEditingRowIndex = row ? row._rowIndex : null;

  const activeTabTitles = {
    purchases: 'IT Purchase / License',
    domains: 'Domain Record',
    servers: 'Server Details',
    aiModels: 'AI Model License',
    courses: 'Course / Training Detail'
  };
  modalTitle.textContent = (row ? 'Edit ' : 'Add ') + (activeTabTitles[activeTab] || 'Item');

  // Build dynamic input fields
  modalFormFields.innerHTML = '';
  resetUploadArea();

  sheetData.headers.forEach(header => {
    // We handle Invoice File in a separate file upload area
    if (header.toLowerCase() === 'invoice file') {
      if (row && row[header]) {
        invoiceFilePathHidden.value = row[header];
        uploadFilenameLabel.textContent = 'Existing invoice attached';
      }
      return;
    }

    const div = document.createElement('div');
    div.className = 'form-group';
    
    const headerLower = header.toLowerCase();
    if (headerLower.includes('purpose') || headerLower.includes('detail') || headerLower.includes('link') || headerLower.includes('url')) {
      div.className = 'form-group full-width';
    }

    const label = document.createElement('label');
    label.textContent = header;
    div.appendChild(label);

    let input;
    const value = row ? (row[header] || '') : '';

    if (headerLower.includes('expiry') || headerLower.includes('date')) {
      input = document.createElement('input');
      input.type = 'date';
      input.name = header;
      if (value) {
        try {
          const d = new Date(value);
          if (!isNaN(d.getTime())) {
            input.value = d.toISOString().split('T')[0];
          }
        } catch (e) {
          input.value = value;
        }
      }
    } else if (headerLower.includes('purpose') || headerLower.includes('details')) {
      input = document.createElement('textarea');
      input.rows = 3;
      input.name = header;
      input.value = value;
    } else if (headerLower === 'plan' || headerLower === 'license #') {
      input = document.createElement('select');
      input.name = header;
      
      const options = ['Monthly', 'Yearly', 'One-time', 'Quarterly', 'Free', 'Other'];
      options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        if (value.toLowerCase() === opt.toLowerCase() || (value.includes(opt) && opt !== 'Other')) {
          option.selected = true;
        }
        input.appendChild(option);
      });
      if (value && !options.some(opt => value.toLowerCase() === opt.toLowerCase() || value.includes(opt))) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        option.selected = true;
        input.appendChild(option);
      }
    } else {
      const isCostField = headerLower === 'cost' || headerLower === 'price' || headerLower === 'renewal price';
      if (isCostField) {
        let currentCurrency = '₹';
        let currentAmount = '';
        if (value) {
          const valStr = String(value).trim();
          if (valStr.startsWith('$')) { currentCurrency = '$'; currentAmount = valStr.substring(1).trim(); }
          else if (valStr.startsWith('€')) { currentCurrency = '€'; currentAmount = valStr.substring(1).trim(); }
          else if (valStr.startsWith('A$')) { currentCurrency = 'A$'; currentAmount = valStr.substring(2).trim(); }
          else if (valStr.startsWith('₹')) { currentCurrency = '₹'; currentAmount = valStr.substring(1).trim(); }
          else {
            const num = parseFloat(valStr.replace(/[^\d.-]/g, ''));
            currentAmount = isNaN(num) ? valStr : String(num);
            if (activeTab === 'aiModels' && num <= 1000) {
              currentCurrency = '$';
            }
          }
        }
        
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.gap = '0.5rem';
        
        const select = document.createElement('select');
        select.className = 'currency-selector';
        select.style.width = '85px';
        select.style.flexShrink = '0';
        select.innerHTML = `
          <option value="₹">₹ (INR)</option>
          <option value="$">$ (USD)</option>
          <option value="€">€ (EUR)</option>
          <option value="A$">A$ (AUD)</option>
        `;
        select.value = currentCurrency;
        
        input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.className = 'currency-amount-input';
        input.name = header;
        input.value = currentAmount;
        input.placeholder = '0.00';
        input.style.flexGrow = '1';
        
        wrapper.appendChild(select);
        wrapper.appendChild(input);
        div.appendChild(wrapper);
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.name = header;
        input.value = value;
        div.appendChild(input);
      }
    }

    if (input) {
      input.id = `input-${header.replace(/\s+/g, '-')}`;
    }
    modalFormFields.appendChild(div);
  });

  formModal.classList.add('open');
}

// Close Modal
function closeModal() {
  formModal.classList.remove('open');
  purchaseForm.reset();
  resetUploadArea();
  currentEditingRowIndex = null;
}

// Submit forms to express server
async function handleFormSubmit(e) {
  e.preventDefault();
  
  const formData = {};
  const inputs = modalFormFields.querySelectorAll('input, textarea, select');
  
  inputs.forEach(input => {
    if (input.className === 'currency-amount-input') {
      const select = input.previousElementSibling;
      if (select && select.className === 'currency-selector') {
        formData[input.name] = select.value + ' ' + input.value;
      } else {
        formData[input.name] = input.value;
      }
    } else if (input.className === 'currency-selector') {
      // skip
    } else if (input.name) {
      formData[input.name] = input.value;
    }
  });

  // Attach invoice path if uploaded
  if (invoiceFilePathHidden.value) {
    formData['Invoice File'] = invoiceFilePathHidden.value;
  }

  try {
    const payload = {
      type: activeTab,
      rowIndex: currentEditingRowIndex,
      data: formData
    };

    const response = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    if (result.success) {
      showToast(currentEditingRowIndex ? 'Row updated successfully!' : 'New row added successfully!', 'success');
      closeModal();
      fetchData();
    } else {
      showToast('Error saving: ' + result.error, 'error');
    }
  } catch (error) {
    showToast('Failed to save data to Excel', 'error');
  }
}

// Delete Confirmation logic
function confirmDelete(rowIndex) {
  if (confirm('Are you sure you want to permanently delete this entry? This will remove the row and shift subsequent entries up.')) {
    deleteRow(rowIndex);
  }
}

async function deleteRow(rowIndex) {
  try {
    const response = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: activeTab, rowIndex })
    });
    const result = await response.json();
    if (result.success) {
      showToast('Entry deleted successfully!', 'success');
      fetchData();
    } else {
      showToast('Error deleting: ' + result.error, 'error');
    }
  } catch (error) {
    showToast('Failed to delete entry', 'error');
  }
}

// Toast Notifications Helper
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const svgIcon = type === 'success' 
    ? `<svg viewBox="0 0 24 24" fill="var(--success)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="var(--danger)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;

  toast.innerHTML = `
    ${svgIcon}
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease-in-out forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Add fading keyframe dynamically to head
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes fadeOut {
    from { transform: scale(1); opacity: 1; }
    to { transform: scale(0.9); opacity: 0; }
  }
`;
document.head.appendChild(styleSheet);
