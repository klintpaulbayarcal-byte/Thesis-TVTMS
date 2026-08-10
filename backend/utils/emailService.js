/**
 * emailService.js
 * Email notification service for LGU Violation System.
 *
 * For local LGU deployment: configure SMTP in .env.
 * Uses Nodemailer. When SMTP is unavailable, delivery returns false without logging recipient data.
 *
 * .env variables:
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=587
 *   SMTP_USER=youremail@gmail.com
 *   SMTP_PASS=yourapppassword
 *   SMTP_FROM="Municipal Traffic Enforcement <youremail@gmail.com>"
 */

const db = require('../config/database');

let transporter = null;

const getSmtpConfig = () => {
    const resendKey = String(process.env.RESEND_API_KEY || '').trim();
    const host = process.env.SMTP_HOST || (resendKey ? 'smtp.resend.com' : '');
    const port = parseInt(process.env.SMTP_PORT || (resendKey ? '465' : '587'), 10);
    return {
        host,
        port,
        user: process.env.SMTP_USER || (resendKey ? 'resend' : ''),
        pass: process.env.SMTP_PASS || resendKey,
        from: process.env.SMTP_FROM || ''
    };
};

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

const readSettings = async (keys) => {
    try {
        const [rows] = await db.query(
            `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (${keys.map(() => '?').join(',')})`,
            keys
        );
        return Object.fromEntries(rows.map(row => [row.setting_key, row.setting_value]));
    } catch (error) {
        console.warn('[EmailService] Unable to read system settings:', error.message);
        return {};
    }
};

const isSettingEnabled = async (key, defaultValue = true) => {
    const settings = await readSettings([key]);
    if (!(key in settings)) return defaultValue;
    return ['1', 'true', 'on', 'yes'].includes(String(settings[key]).trim().toLowerCase());
};

const getSystemIdentity = async () => {
    const settings = await readSettings(['lgu_name', 'lgu_address', 'lgu_contact', 'system_title']);
    return {
        lguName: settings.lgu_name || 'Municipality of Calape',
        lguAddress: settings.lgu_address || 'Calape, Bohol',
        lguContact: settings.lgu_contact || '',
        systemTitle: settings.system_title || 'Municipal Traffic Violation Ticketing and Management System'
    };
};

const getTransporter = () => {
    if (transporter) return transporter;

    const config = getSmtpConfig();
    if (!config.host || !config.user || !config.pass) {
        return null;
    }

    try {
        const nodemailer = require('nodemailer');
        const port = config.port;
        const secure = process.env.SMTP_SECURE === '1' || (process.env.SMTP_SECURE !== '0' && port === 465);
        transporter = nodemailer.createTransport({
            host: config.host,
            port,
            secure,
            auth: {
                user: config.user,
                pass: config.pass
            },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 15000,
            tls: { minVersion: 'TLSv1.2', rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== '0' }
        });
        return transporter;
    } catch {
        return null;
    }
};

exports.getSmtpStatus = () => ({
    ...(() => {
        const config = getSmtpConfig();
        return { configured: Boolean(config.host && config.user && config.pass && config.from), host: config.host || null, port: config.port };
    })()
});

exports.verifySmtpConnection = async () => {
    const transport = getTransporter();
    if (!transport) throw new Error('SMTP_HOST, SMTP_USER, and SMTP_PASS must be configured.');
    await transport.verify();
    return true;
};

/**
 * Send a violation notice email to the vehicle owner.
 * Non-fatal — failures are logged but do not break ticket creation.
 */
exports.sendViolationNotice = async (toEmail, ownerName, ticketData) => {
    if (!(await isSettingEnabled('send_violation_notice', true))) return false;
    const identity = await getSystemIdentity();
    const transport = getTransporter();

    const subject = `[${identity.lguName}] Violation Notice — Ticket ${escapeHtml(ticketData.ticket_number)}`;
    const penaltyFormatted = Number(ticketData.penalty_amount || 0).toLocaleString('en-PH', {
        style: 'currency', currency: 'PHP'
    });

    const html = `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden">
            <div style="background:#1a237e;color:#fff;padding:20px 24px">
                <h2 style="margin:0;font-size:18px">${escapeHtml(identity.systemTitle)}</h2>
                <p style="margin:4px 0 0;font-size:13px;opacity:0.8">${escapeHtml(identity.lguName)} — Official Violation Notice</p>
            </div>
            <div style="padding:24px">
                <p>Dear <strong>${escapeHtml(ownerName)}</strong>,</p>
                <p>A traffic violation has been recorded against your vehicle. Please settle this at the Municipal Hall cashier.</p>
                <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
                    <tr style="background:#f5f5f5">
                        <td style="padding:8px 12px;font-weight:600;width:40%">Ticket No.</td>
                        <td style="padding:8px 12px">${escapeHtml(ticketData.ticket_number)}</td>
                    </tr>
                    <tr>
                        <td style="padding:8px 12px;font-weight:600">Plate Number</td>
                        <td style="padding:8px 12px">${escapeHtml(ticketData.plate_number)}</td>
                    </tr>
                    <tr style="background:#f5f5f5">
                        <td style="padding:8px 12px;font-weight:600">Violation</td>
                        <td style="padding:8px 12px">${escapeHtml(ticketData.violation_name)}</td>
                    </tr>
                    <tr>
                        <td style="padding:8px 12px;font-weight:600">Date Issued</td>
                        <td style="padding:8px 12px">${escapeHtml(ticketData.date_issued)} at ${escapeHtml(ticketData.time_issued)}</td>
                    </tr>
                    <tr style="background:#f5f5f5">
                        <td style="padding:8px 12px;font-weight:600">Location</td>
                        <td style="padding:8px 12px">${escapeHtml(ticketData.location || 'Not specified')}</td>
                    </tr>
                    <tr>
                        <td style="padding:8px 12px;font-weight:600">Penalty Amount</td>
                        <td style="padding:8px 12px"><strong style="color:#c62828">${penaltyFormatted}</strong></td>
                    </tr>
                </table>
                <p style="font-size:13px;color:#555">Please follow the deadline and payment instructions stated on the official citation or contact ${escapeHtml(identity.lguName)}${identity.lguContact ? ` at ${escapeHtml(identity.lguContact)}` : ''} for guidance.</p>
                <p style="font-size:12px;color:#888;margin-top:20px">This is an automated message from the Municipal Traffic Violation Ticketing and Management System. Do not reply to this email.</p>
            </div>
        </div>
    `;

    if (!transport) {
        console.warn('[EmailService] Violation notice skipped because SMTP is not configured.');
        return false;
    }

    try {
        await transport.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: toEmail,
            subject,
            html
        });
        return true;
    } catch (error) {
        console.error('[EmailService] Violation notice delivery failed:', error.message);
        return false;
    }
};

/**
 * Send password reset email.
 * The reset link is sent only by email and is never returned by the API.
 */
exports.sendPasswordResetEmail = async (toEmail, resetLink) => {
    const transport = getTransporter();

    if (!transport) {
        console.error('[EmailService] SMTP is not configured; password reset email was not sent.');
        return false;
    }

    try {
        await transport.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: toEmail,
            subject: '[LGU System] Password Reset Request',
            html: `
                <p>A password reset was requested for your LGU Violation System account.</p>
                <p><a href="${escapeHtml(resetLink)}" style="color:#1a237e">Click here to reset your password</a></p>
                <p>This link expires in 1 hour. If you did not request this, ignore this email.</p>
            `
        });
        return true;
    } catch (error) {
        console.error('[EmailService] Password reset email delivery failed:', error.message);
        return false;
    }
};



exports.sendPaymentConfirmation = async (toEmail, ownerName, paymentData) => {
    if (!(await isSettingEnabled('send_payment_confirmation', true))) return false;
    const identity = await getSystemIdentity();
    const transport=getTransporter(); if(!transport) return false;
    try { await transport.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to:toEmail,subject:`${identity.lguName} payment recorded — ${paymentData.ticket_number}`,html:`<p>Dear ${escapeHtml(ownerName)},</p><p>Payment for ticket <strong>${escapeHtml(paymentData.ticket_number)}</strong> was recorded.</p><p>Official Receipt: ${escapeHtml(paymentData.or_number)}<br>Amount: PHP ${Number(paymentData.amount_paid||0).toFixed(2)}<br>Date: ${escapeHtml(paymentData.payment_date)}</p>`}); return true; }
    catch(error){ console.error('Payment email failed:',error.message); return false; }
};

exports.sendDisputeUpdate = async (toEmail, ownerName, disputeData) => {
    const identity = await getSystemIdentity();
    const transport=getTransporter(); if(!transport) return false;
    try { await transport.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to:toEmail,subject:`${identity.lguName} dispute update — ${disputeData.ticket_number}`,html:`<p>Dear ${escapeHtml(ownerName)},</p><p>Your dispute for ticket <strong>${escapeHtml(disputeData.ticket_number)}</strong> is now <strong>${escapeHtml(disputeData.dispute_status)}</strong>.</p><p>${escapeHtml(disputeData.resolution_notes||'')}</p>`}); return true; }
    catch(error){ console.error('Dispute email failed:',error.message); return false; }
};

exports.sendPublicContact = async ({name,email,subject,message}) => {
    const identity = await getSystemIdentity();
    const transport=getTransporter(); const to=process.env.CONTACT_TO_EMAIL||process.env.SMTP_USER; if(!transport||!to)return false;
    const safeSubject = String(subject || 'General inquiry').replace(/[\r\n]+/g, ' ').trim();
    try { await transport.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to,replyTo:email,subject:`${identity.lguName} public portal inquiry: ${safeSubject}`,html:`<p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Email:</strong> ${escapeHtml(email)}</p><p><strong>Subject:</strong> ${escapeHtml(safeSubject)}</p><p>${escapeHtml(message).replace(/\n/g,'<br>')}</p>`}); return true; }
    catch(error){ console.error('Contact email failed:',error.message); return false; }
};
