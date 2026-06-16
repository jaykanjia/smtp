# Outlook MailHub

A sleek Node.js application and web dashboard to send emails using Microsoft 365 OAuth2 via Microsoft Graph API and Outlook SMTP.

---

## ⚙️ Azure AD App Registration Setup

Since this application runs in the background (Client Credentials flow: Client ID, Secret, Tenant ID) without interactive user sign-in, you must configure permissions in your Azure Active Directory / Microsoft Entra ID tenant.

### 1. Microsoft Graph API Setup (Recommended)
This is the modern and secure way to send emails using client credentials.
1. Go to **Azure Portal** > **Microsoft Entra ID** > **App Registrations** > **New Registration**.
2. Go to **API Permissions** > **Add a permission** > **Microsoft Graph** > **Application permissions**.
3. Search for and select **`Mail.Send`**.
4. Click **Grant admin consent for <your-tenant>** (requires global admin permission).
5. Generate a client secret under **Certificates & Secrets** > **New Client Secret**. Keep this safe!

### 2. Outlook SMTP (Nodemailer OAuth2) Setup (Alternative)
SMTP with Client Credentials flow is highly restricted and requires manual Exchange Online setup.
1. In Azure AD App Registration, go to **API Permissions** > **Add a permission** > **APIs my organization uses** > Search for **Office 365 Exchange Online** > select **Application permissions** > check **`SMTP.SendAsApp`**. Click **Grant admin consent**.
2. **Register the Service Principal in Exchange Online** (requires Exchange Administrator role):
   Open PowerShell and run:
   ```powershell
   # Connect to Exchange Online PowerShell
   Connect-ExchangeOnline

   # Create the service principal inside Exchange Online matching your Azure AD App ID
   New-ServicePrincipal -AppId "YOUR_CLIENT_ID" -ServiceId "YOUR_APP_OBJECT_ID" -DisplayName "SMTP Mail App"

   # Grant full access mailbox permissions to the service principal for the sender mailbox
   Add-MailboxPermission -Identity "sender@yourdomain.com" -User "YOUR_CLIENT_ID" -AccessRights FullAccess
   ```
3. Make sure **SMTP AUTH** is enabled for the mailbox in the Microsoft 365 Admin Center (`Active Users` > Click User > `Mail` tab > `Manage email apps` > Check `Authenticated SMTP`).

---

## 🚀 Running the Application

### 1. Setup Environment Configuration
Copy the `.env.example` file to `.env`:
```bash
cp .env.example .env
```
Open `.env` and fill in your details:
```env
TENANT_ID=your_tenant_id
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
SENDER_EMAIL=sender@yourdomain.com
PORT=3000
```

### 2. Install dependencies
```bash
npm install
```

### 3. Run the Web Dashboard
```bash
npm start
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Run via Command Line Interface (CLI)

#### Using Graph API:
```bash
node send_email_graph.js recipient@domain.com "Subject Text" "<h1>Hello World</h1><p>Body HTML or text.</p>"
```

#### Using SMTP:
```bash
node send_email_smtp.js recipient@domain.com "Subject Text" "<h1>Hello World</h1><p>Body HTML or text.</p>"
```
