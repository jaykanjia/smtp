const axios = require('axios');
const { getAccessToken } = require('./auth');
require('dotenv').config();

/**
 * Sends an email using the Microsoft Graph API.
 * @param {Object} options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Subject of the email
 * @param {string} options.body - Body text or HTML of the email
 * @param {boolean} [options.isHtml=true] - Whether the body is HTML
 * @returns {Promise<Object>} - The API response data or a success status
 */
async function sendEmailViaGraph({ to, subject, body, isHtml = true }) {
    const senderEmail = process.env.SENDER_EMAIL;
    if (!senderEmail) {
        throw new Error('SENDER_EMAIL is not defined in the environment variables.');
    }

    console.log('Fetching access token for Microsoft Graph...');
    const accessToken = await getAccessToken(['https://graph.microsoft.com/.default']);
    console.log('Access token acquired successfully.');

    const graphEndpoint = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`;

    const requestBody = {
        message: {
            subject: subject,
            body: {
                contentType: isHtml ? 'HTML' : 'Text',
                content: body
            },
            toRecipients: [
                {
                    emailAddress: {
                        address: to
                    }
                }
            ]
        },
        saveToSentItems: 'true'
    };

    console.log(`Sending email from ${senderEmail} to ${to} via Graph API...`);
    const response = await axios.post(graphEndpoint, requestBody, {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
    });

    console.log('Email sent successfully!');
    return { success: true, status: response.status };
}

// Support executing directly via CLI: node send_email_graph.js recipient@example.com "Subject" "Message body"
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length < 3) {
        console.log('Usage: node send_email_graph.js <recipient_email> <subject> <body>');
        process.exit(1);
    }

    const [to, subject, body] = args;
    sendEmailViaGraph({ to, subject, body })
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Failed to send email:', err.response ? err.response.data : err.message);
            process.exit(1);
        });
}

module.exports = {
    sendEmailViaGraph
};
