# KD Purchases & Billing Dashboard

A secure, local, and ultra-lightweight dashboard designed to track IT purchases, licenses, credentials, domains, hosting plans, and AI models. It runs locally on your machine and supports dual-mode synchronization: editing a local Excel spreadsheet or syncing in real-time with a live cloud Google Sheet.

---

## ✨ Features

* 📊 **Executive Analytics:** Unified summary card metrics (monthly spend, subscriptions, domains, expirations) and a custom line chart displaying 12-month spending trends.
* 📦 **Zero-Dependency SVG Graphics:** 100% offline, responsive, and lightweight charts and icons rendered natively in HTML/CSS with 0KB of external library overhead.
* 🔒 **Admin Authentication Passcode:** Session-based security gate that redirects unauthorized users to a glassmorphism login page.
* 📂 **Invoice File Management:** Upload PDF/image receipts directly through the UI. Invoices are saved on the server, and a direct download button is rendered inside the table row.
* 🔍 **Smart Filters & Searches:** Instantly filter databases by name, expiry status, or specific hosting providers (e.g. show DigitalOcean history only).
* 📧 **7-Day Expiry Email Reports:** Background worker scans expiries once daily and sends automated HTML emails notifying you 7 days before any tool, domain, or server expires.
* 🔄 **Dual Database Sync Engine:** Auto-syncs to Google Sheets if credentials exist; otherwise, falls back to editing a local Excel workbook.

---

## 🛠️ Installation & Getting Started

### Prerequisites
* [Node.js](https://nodejs.org/) (v16.0.0 or higher)

### Setup Instructions
1. Clone the repository to your machine.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the template configuration file to create your active `.env`:
   ```bash
   cp .env.example .env
   ```
4. Open the [`.env`](.env) file and configure your settings:
   * `ADMIN_PASSWORD`: Your admin page passcode (default is `admin123`).
   * `SMTP_USER` & `SMTP_PASS`: Details to enable automated email alerts.

5. Start the local server:
   ```bash
   node server.js
   ```
6. Open your web browser and navigate to: **[http://localhost:3000](http://localhost:3000)**

---

## ☁️ Connecting Google Sheets (Detailed Setup Guide)

Connecting your dashboard to Google Sheets allows multiple team members to view and update the sheet online while keeping the dashboard frontend synced in real-time. Follow these steps:

### Step 1: Prepare Your Google Sheet
1. Open your Google Drive and create a new Google Sheet.
2. Ensure it contains the following tabs, named exactly as follows (matching capitalization):
   * `IT Purchases`
   * `Domains`
   * `Server and Hosting`
   * `AI and GPT Models`
   * `Courses and Training`
   * `Monthly Billing History`
   * `Inactive Assets`
3. Add your headers (column names) in the first row of each tab (e.g. copy the column names from your local Excel file `Master_IT_Purchases_and_Billing.xlsx`).

### Step 2: Set Up Google Cloud & Service Account
To let the Node.js server write to your Google Sheet, we need to generate a secure Google Service Account.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., "KD-Purchases-Dashboard").
3. Search for the **Google Sheets API** in the search bar at the top, click it, and click **Enable**.
4. Go to **IAM & Admin** > **Service Accounts** in the left sidebar.
5. Click **+ Create Service Account** at the top.
   * Provide a name (e.g., "sheets-sync-bot").
   * Click **Create and Continue**, then click **Done**.
6. Find your newly created Service Account in the list, and click on its email address to open its settings.
7. Click the **Keys** tab at the top.
8. Click **Add Key** > **Create new key**.
9. Select **JSON** as the key type and click **Create**.
10. A JSON file will download to your computer.

### Step 3: Add Credentials to Your Project
1. Locate the downloaded JSON private key file on your computer.
2. Rename the file to **`google-credentials.json`**.
3. Place this file directly in the root of your project directory (the folder containing `server.js`).
4. *Note: This file is already excluded in `.gitignore` to prevent committing private keys to GitHub.*

### Step 4: Configure Your Environment Variables
1. Open your Google Sheet in the browser.
2. Look at the URL and copy the Sheet ID. It is the long string of characters between `/d/` and `/edit` in the URL:
   `https://docs.google.com/spreadsheets/d/1x2y3zYOUR_SHEET_ID_HERE/edit`
3. Open the [`.env`](.env) file in your workspace.
4. Locate the `GOOGLE_SHEET_ID` variable and paste your ID:
   ```ini
   GOOGLE_SHEET_ID=1x2y3zYOUR_SHEET_ID_HERE
   ```

### Step 5: Share the Sheet with Your Service Account
Google Sheets are private by default. You must share your sheet with the service account so it can read and write to it.

1. Open your `google-credentials.json` file.
2. Copy the value next to `"client_email"` (it will look like `sheets-sync-bot@yourproject.iam.gserviceaccount.com`).
3. Open your Google Sheet in your web browser.
4. Click the **Share** button in the top-right corner.
5. Paste the Service Account's client email address into the invite box.
6. Set its permission level to **Editor** and click **Send**.

---

## 🚀 Running Your Synced App
Once completed, restart your Node.js application:
```bash
node server.js
```
The server output in the terminal will now read:
```text
KD Purchases Server running on http://localhost:3000
Active Database Sync Mode: [Google Sheets]
```
The bottom of your dashboard sidebar will also update to **Sync: Google Sheets**. Any additions, edits, uploads, or archives done through the webpage will now sync instantly with your Google Sheet in the cloud!
