const msal = require('@azure/msal-node');
require('dotenv').config();

/**
 * Get an OAuth2 access token for the given scopes.
 * @param {string[]} scopes - The scopes to request (e.g. ['https://graph.microsoft.com/.default'])
 * @returns {Promise<string>} - Resolves to the access token string
 */
async function getAccessToken(scopes) {
    if (!process.env.CLIENT_ID || !process.env.CLIENT_SECRET || !process.env.TENANT_ID) {
        throw new Error('Missing authentication configuration (CLIENT_ID, CLIENT_SECRET, or TENANT_ID) in .env file.');
    }

    const msalConfig = {
        auth: {
            clientId: process.env.CLIENT_ID,
            authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
            clientSecret: process.env.CLIENT_SECRET,
        }
    };

    const cca = new msal.ConfidentialClientApplication(msalConfig);

    const tokenRequest = {
        scopes: scopes,
    };

    try {
        const response = await cca.acquireTokenByClientCredential(tokenRequest);
        if (!response || !response.accessToken) {
            throw new Error('Did not receive an access token from MSAL.');
        }
        return response.accessToken;
    } catch (error) {
        console.error('MSAL Error acquiring token:', error.message || error);
        throw error;
    }
}

module.exports = {
    getAccessToken
};
