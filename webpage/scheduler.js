const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Helper to check if SMTP settings are configured in env
function isEmailConfigured() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.NOTIFICATION_EMAIL_TO
  );
}

// Check expiries and send email notification
async function checkExpirationsAndNotify(loadDataFunction) {
  if (!isEmailConfigured()) {
    console.log('[Scheduler] SMTP email notifications are not configured in .env. Skipping check.');
    return { success: false, reason: 'SMTP not configured' };
  }

  console.log('[Scheduler] Running daily check for items expiring in <= 7 days...');
  
  try {
    const data = await loadDataFunction();
    const expiringItems = [];
    const now = new Date();
    
    console.log(`[Scheduler] Checking for expiry dates <= 7 days from now`);

    const typesToCheck = [
      { key: 'purchases', name: 'IT Purchase / License', nameField: 'Tool Name' },
      { key: 'domains', name: 'Domain Registration', nameField: 'Domain Name' },
      { key: 'servers', name: 'Server & Hosting Plan', nameField: 'Server Name' }
    ];

    typesToCheck.forEach(typeInfo => {
      const sheetData = data[typeInfo.key];
      if (sheetData && sheetData.rows) {
        sheetData.rows.forEach(row => {
          if (row['Expiry']) {
            try {
              const expDate = new Date(row['Expiry']);
              if (!isNaN(expDate.getTime())) {
                const expMidnight = new Date(expDate.getFullYear(), expDate.getMonth(), expDate.getDate());
                const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const diffTime = expMidnight.getTime() - nowMidnight.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays <= 7) {
                  expiringItems.push({
                    type: typeInfo.name,
                    name: row[typeInfo.nameField] || 'Unnamed item',
                    cost: row['Cost'] || row['Renewal Price'] || row['COST'] || 'N/A',
                    expiry: row['Expiry'],
                    owner: row['ID'] || row['Username'] || 'N/A'
                  });
                }
              }
            } catch (e) {
              console.error('[Scheduler] Error parsing expiry date:', row['Expiry'], e);
            }
          }
        });
      }
    });

    if (expiringItems.length === 0) {
      console.log('[Scheduler] No items expiring in <= 7 days.');
      return { success: true, count: 0 };
    }

    console.log(`[Scheduler] Found ${expiringItems.length} items expiring soon. Sending email notification...`);
    await sendAlertEmail(expiringItems);
    return { success: true, count: expiringItems.length, items: expiringItems };
  } catch (error) {
    console.error('[Scheduler] Error running expiry notifications check:', error);
    return { success: false, error: error.message };
  }
}

// Send alert email using nodemailer
async function sendAlertEmail(items) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: parseInt(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  // Build beautiful HTML email body
  let itemsHtml = '';
  items.forEach(item => {
    itemsHtml += `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px; font-weight: bold; color: #1e293b;">${item.name}</td>
        <td style="padding: 10px; color: #475569;">${item.type}</td>
        <td style="padding: 10px; color: #dc2626; font-weight: bold;">${item.expiry}</td>
        <td style="padding: 10px; color: #475569;">${item.cost}</td>
        <td style="padding: 10px; color: #475569; font-family: monospace;">${item.owner}</td>
      </tr>
    `;
  });

  const mailOptions = {
    from: `"KD Purchases Dashboard" <${process.env.SMTP_USER}>`,
    to: process.env.NOTIFICATION_EMAIL_TO,
    subject: `⚠️ URGENT: ${items.length} IT Purchases/Domains Expiring in <= 7 Days`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #cbd5e1; border-radius: 8px; background-color: #f8fafc;">
        <h2 style="color: #0f172a; border-bottom: 2px solid #ef4444; padding-bottom: 10px; margin-top: 0;">⚠️ Expiration Alerts Center</h2>
        <p style="color: #334155; font-size: 16px;">This is an automated reminder that the following items are expiring in <b>7 days or less</b>. Please review and process their renewals.</p>
        
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px; text-align: left;">
          <thead>
            <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
              <th style="padding: 10px; color: #475569;">Asset / Tool</th>
              <th style="padding: 10px; color: #475569;">Category</th>
              <th style="padding: 10px; color: #475569;">Expiry Date</th>
              <th style="padding: 10px; color: #475569;">Cost</th>
              <th style="padding: 10px; color: #475569;">ID / Login</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>
        
        <p style="color: #64748b; font-size: 12px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px; text-align: center;">
          Sent from local IT Purchases Dashboard server. To access or manage these records, open <a href="http://localhost:3000" style="color: #4f46e5; text-decoration: none; font-weight: bold;">http://localhost:3000</a>.
        </p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('[Scheduler] Expiry notification email sent successfully.');
}

// Start Background loop (run once every 24 hours)
function startNotificationScheduler(loadDataFunction) {
  // Run first check 30 seconds after server starts
  setTimeout(() => {
    checkExpirationsAndNotify(loadDataFunction);
  }, 30000);

  // Then set interval for once every 24 hours
  const INTERVAL_24H = 24 * 60 * 60 * 1000;
  setInterval(() => {
    checkExpirationsAndNotify(loadDataFunction);
  }, INTERVAL_24H);
  
  console.log('[Scheduler] 7-Day Expiry Notification Scheduler initialized.');
}

module.exports = {
  startNotificationScheduler,
  checkExpirationsAndNotify,
  isEmailConfigured
};
