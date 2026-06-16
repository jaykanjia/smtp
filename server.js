const express = require('express');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const { sendEmailViaGraph } = require('./send_email_graph');
const { sendEmailViaSMTP } = require('./send_email_smtp');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Endpoint to verify configuration status (checks if environment variables are set)
 */
app.get('/api/config', (req, res) => {
    res.json({
        tenantId: !!process.env.TENANT_ID,
        clientId: !!process.env.CLIENT_ID,
        clientSecret: !!process.env.CLIENT_SECRET,
        senderEmail: process.env.SENDER_EMAIL || null
    });
});

/**
 * Endpoint to send emails via Microsoft Graph API or SMTP OAuth2
 */
app.post('/api/send', async (req, res) => {
    const { method, to, subject, body, isHtml } = req.body;

    if (!to || !subject || !body) {
        return res.status(400).json({ success: false, error: 'Recipient, subject, and body are required fields.' });
    }

    // Intercept console.log to stream logs back to UI
    const requestLogs = [];
    const originalLog = console.log;
    const originalError = console.error;

    console.log = (...args) => {
        const formatted = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
        requestLogs.push(formatted);
        originalLog(...args);
    };

    console.error = (...args) => {
        const formatted = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
        requestLogs.push(`[ERROR] ${formatted}`);
        originalError(...args);
    };

    try {
        console.log(`Starting delivery process using ${method.toUpperCase()} protocol...`);
        let result;

        if (method === 'graph') {
            result = await sendEmailViaGraph({ to, subject, body, isHtml });
        } else if (method === 'smtp') {
            result = await sendEmailViaSMTP({ to, subject, body, isHtml });
        } else {
            throw new Error(`Unsupported delivery method: ${method}`);
        }

        // Restore console logs
        console.log = originalLog;
        console.error = originalError;

        res.json({
            success: true,
            message: `Email successfully sent using ${method === 'graph' ? 'Microsoft Graph API' : 'Outlook SMTP'}.`,
            messageId: result.messageId || null,
            logs: requestLogs
        });

    } catch (error) {
        // Restore console logs
        console.log = originalLog;
        console.error = originalError;

        let errorDetails = error.message;
        if (error.response && error.response.data) {
            errorDetails = JSON.stringify(error.response.data);
        }

        res.status(500).json({
            success: false,
            error: errorDetails,
            logs: requestLogs
        });
    }
});

app.listen(PORT, () => {
    console.log(`========================================================`);
    console.log(` Outlook Email Portal running at http://localhost:${PORT}`);
    console.log(`========================================================`);
});
