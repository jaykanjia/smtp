document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const configList = document.getElementById('configList');
    const emailForm = document.getElementById('emailForm');
    const radioOptions = document.querySelectorAll('.radio-option');
    const sendBtn = document.getElementById('sendBtn');
    const btnLoader = sendBtn.querySelector('.btn-loader');
    const btnText = sendBtn.querySelector('.btn-text');
    const feedbackContainer = document.getElementById('feedbackContainer');
    const feedbackAlert = document.getElementById('feedbackAlert');
    const feedbackIcon = document.getElementById('feedbackIcon');
    const feedbackTitle = document.getElementById('feedbackTitle');
    const feedbackText = document.getElementById('feedbackText');
    const logsContent = document.getElementById('logsContent');
    const clearLogsBtn = document.getElementById('clearLogs');

    // Fetch config status on load
    fetchConfigStatus();

    // Setup custom radio card toggles
    radioOptions.forEach(option => {
        const input = option.querySelector('input[type="radio"]');
        option.addEventListener('click', () => {
            radioOptions.forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');
            input.checked = true;
        });
    });

    // Form submission handler
    emailForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Form data
        const formData = new FormData(emailForm);
        const method = formData.get('method');
        const to = formData.get('to');
        const subject = formData.get('subject');
        const body = formData.get('body');
        const isHtml = document.getElementById('isHtml').checked;

        // Reset feedback
        feedbackContainer.classList.add('hidden');
        logsContent.textContent = 'Initiating mail delivery process...\n';
        
        // Show loading state
        setLoading(true);

        const log = (message) => {
            const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
            logsContent.textContent += `[${timestamp}] ${message}\n`;
            logsContent.scrollTop = logsContent.scrollHeight;
        };

        log(`Method chosen: ${method.toUpperCase()}`);
        log(`Recipient: ${to}`);
        log(`Subject: "${subject}"`);
        log(`Format: ${isHtml ? 'HTML' : 'Plain Text'}`);
        log(`Fetching access token & dispatching request to local backend...`);

        try {
            const response = await fetch('/api/send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ method, to, subject, body, isHtml })
            });

            const result = await response.json();
            
            // Append backend logs to local output
            if (result.logs && Array.isArray(result.logs)) {
                result.logs.forEach(l => log(`[SERVER] ${l}`));
            }

            if (response.ok && result.success) {
                log(`Success! Server returned status code ${response.status}`);
                if (result.messageId) log(`SMTP Message ID: ${result.messageId}`);
                showFeedback(true, 'Email Dispatched successfully!', result.message || 'Your email has been sent successfully using Microsoft Entra ID authentication credentials.');
            } else {
                log(`Error occurred on server. Status: ${response.status}`);
                const errMsg = result.error || 'Unknown server error.';
                log(`Server Error Detail: ${errMsg}`);
                showFeedback(false, 'Delivery Failed', errMsg);
            }
        } catch (err) {
            log(`Network/fetch exception: ${err.message}`);
            showFeedback(false, 'Network Error', `Unable to communicate with the local Node.js server: ${err.message}`);
        } finally {
            setLoading(false);
        }
    });

    // Clear logs helper
    clearLogsBtn.addEventListener('click', () => {
        logsContent.textContent = 'Logs cleared.\n';
    });

    // Fetch config status from server
    async function fetchConfigStatus() {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) throw new Error('Failed to load server configuration.');
            
            const data = await response.json();
            configList.innerHTML = '';

            const items = [
                { key: 'TENANT_ID', label: 'Tenant ID', val: data.tenantId },
                { key: 'CLIENT_ID', label: 'Client ID', val: data.clientId },
                { key: 'CLIENT_SECRET', label: 'Client Secret', val: data.clientSecret },
                { key: 'SENDER_EMAIL', label: 'Sender Mailbox', val: data.senderEmail }
            ];

            let hasMissing = false;

            items.forEach(item => {
                const configItem = document.createElement('div');
                configItem.className = 'config-item';
                
                const label = document.createElement('span');
                label.className = 'config-name';
                label.textContent = item.label;

                const badge = document.createElement('span');
                if (item.val) {
                    badge.className = 'status-badge configured';
                    badge.innerHTML = `
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right:2px;">
                            <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        Set
                    `;
                } else {
                    badge.className = 'status-badge missing';
                    badge.innerHTML = `
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right:2px;">
                            <path d="M6 10C8.20914 10 10 8.20914 10 6C10 3.79086 8.20914 2 6 2C3.79086 2 2 3.79086 2 6C2 8.20914 3.79086 10 6 10Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                            <path d="M6 4V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                            <path d="M6 8H6.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                        </svg>
                        Missing
                    `;
                    hasMissing = true;
                }

                configItem.appendChild(label);
                configItem.appendChild(badge);
                configList.appendChild(configItem);
            });

            // Adjust form validation warning if configuration is incomplete
            if (hasMissing) {
                logsContent.textContent = 'WARNING: Some environment variables are missing from your .env file.\nPlease check the config panel on the left and set up your values.\n';
                feedbackContainer.classList.remove('hidden');
            }

        } catch (err) {
            configList.innerHTML = `<div class="alert-box error" style="margin:0;">Error checking config: ${err.message}</div>`;
        }
    }

    // Set loading indicator state
    function setLoading(isLoading) {
        if (isLoading) {
            sendBtn.disabled = true;
            btnLoader.classList.remove('hidden');
            btnText.style.opacity = '0.3';
        } else {
            sendBtn.disabled = false;
            btnLoader.classList.add('hidden');
            btnText.style.opacity = '1';
        }
    }

    // Show API feedback
    function showFeedback(isSuccess, title, text) {
        feedbackContainer.classList.remove('hidden');
        feedbackAlert.className = `feedback-alert ${isSuccess ? 'success' : 'error'}`;
        
        feedbackIcon.innerHTML = isSuccess ? '✓' : '✗';
        feedbackTitle.textContent = title;
        feedbackText.textContent = text;
    }
});
