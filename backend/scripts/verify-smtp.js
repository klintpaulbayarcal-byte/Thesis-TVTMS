require('dotenv').config();
const { verifySmtpConnection, getSmtpStatus } = require('../utils/emailService');

(async () => {
    const status = getSmtpStatus();
    if (!status.configured) throw new Error('SMTP is incomplete. Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM.');
    await verifySmtpConnection();
    console.log(`SMTP connection verified (${status.host}:${status.port}).`);
})().catch(error => {
    console.error(`SMTP verification failed: ${error.message}`);
    process.exitCode = 1;
});
