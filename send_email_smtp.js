const nodemailer = require('nodemailer');
const { getAccessToken } = require('./auth');
require('dotenv').config();

/**
 * Sends an email using Nodemailer with Outlook SMTP and OAuth2.
 * @param {Object} options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Subject of the email
 * @param {string} options.body - Body text or HTML of the email
 * @param {boolean} [options.isHtml=true] - Whether the body is HTML
 * @returns {Promise<Object>} - Information about the sent message
 */
async function sendEmailViaSMTP({ to, subject, body, isHtml = true }) {
    const senderEmail = process.env.SENDER_EMAIL;
    if (!senderEmail) {
        throw new Error('SENDER_EMAIL is not defined in the environment variables.');
    }

    console.log('Fetching OAuth2 access token for Outlook SMTP...');
    // The scope required for SMTP OAuth2 client credentials flow in Outlook
    const scope = 'https://outlook.office365.com/.default';
    const accessToken = await getAccessToken([scope]);
    console.log('Access token acquired successfully.');

    console.log('Creating Nodemailer SMTP transporter...');
    const transporter = nodemailer.createTransport({
        host: 'smtp.office365.com',
        port: 587,
        secure: false, // STARTTLS
        auth: {
            type: 'OAuth2',
            user: senderEmail,
            clientId: process.env.CLIENT_ID,
            clientSecret: process.env.CLIENT_SECRET,
            accessToken: accessToken,
        },
        // Enable debug/logger for detailed protocol logs in case of connection/auth issues
        debug: true,
        logger: true
    });

    const mailOptions = {
        from: senderEmail,
        to: to,
        subject: subject,
        [isHtml ? 'html' : 'text']: body
    };

    console.log(`Sending email from ${senderEmail} to ${to} via SMTP...`);
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully!', info.messageId);
    return { success: true, messageId: info.messageId };
}

// Support executing directly via CLI: node send_email_smtp.js recipient@example.com "Subject" "Message body"
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length < 3) {
        console.log('Usage: node send_email_smtp.js <recipient_email> <subject> <body>');
        process.exit(1);
    }

    const [to, subject, body] = args;
    sendEmailViaSMTP({ to, subject, body })
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Failed to send email via SMTP:', err.message || err);
            console.error('\nNOTE: Outlook SMTP with Client Credentials flow requires tenant-level configuration:');
            console.error('1. Grant "SMTP.SendAsApp" application permission in Azure AD App Registration.');
            console.error('2. Register service principal in Exchange Online using PowerShell and run Add-MailboxPermission.');
            console.error('If these are not set up, Microsoft Graph API is highly recommended and easier to configure.');
            process.exit(1);
        });
}

module.exports = {
    sendEmailViaSMTP
};
