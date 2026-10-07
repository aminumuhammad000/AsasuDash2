const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Ensure environment variables are loaded
if (!process.env.EMAIL_USER || !process.env.EMAIL_HOST) {
  const envCandidates = [
    path.resolve(__dirname, '../.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../../.env')
  ];
  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      break;
    }
  }
}

let cachedTransporter = null;
let lastConfigKey = null;

function getTransporter() {
  const host = process.env.EMAIL_HOST || 'smtp.hostinger.com';
  const port = parseInt(process.env.EMAIL_PORT, 10) || 465;
  
  // Intelligent secure setting: 465 is SSL/TLS (secure: true), 587/2525/25 is STARTTLS (secure: false)
  let secure = port === 465;
  if (process.env.EMAIL_SECURE !== undefined && process.env.EMAIL_SECURE !== '') {
    secure = String(process.env.EMAIL_SECURE).trim().toLowerCase() === 'true' || process.env.EMAIL_SECURE === '1';
  }

  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  const currentKey = `${host}:${port}:${secure}:${user}:${pass ? 'hasPass' : 'noPass'}`;
  
  if (cachedTransporter && lastConfigKey === currentKey) {
    return cachedTransporter;
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 5,
    connectionTimeout: 10000, // 10s
    greetingTimeout: 10000,   // 10s
    socketTimeout: 15000,     // 15s
    auth: {
      user,
      pass
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  lastConfigKey = currentKey;
  return cachedTransporter;
}

const isEmailConfigured = () => {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  return Boolean(user && pass && user !== 'your-email@gmail.com' && user !== 'your_email@domain.com');
};

const sendEmail = async (to, subject, text, html) => {
  if (!to) {
    console.warn('[Email Warning] Skipped sending: No recipient specified.');
    return null;
  }

  if (!isEmailConfigured()) {
    console.warn('[Email Warning] Skipping email send: SMTP not configured in .env (EMAIL_USER / EMAIL_PASS missing).');
    console.log(`[Email Mock] To: ${to} | Subject: "${subject}"`);
    return null;
  }

  const transporter = getTransporter();
  const defaultFrom = process.env.EMAIL_USER 
    ? `"ASASU Realty" <${process.env.EMAIL_USER}>` 
    : '"ASASU Portal" <notifications@asasurealty.com>';
  
  const fromAddress = process.env.EMAIL_FROM || defaultFrom;

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      text: text || '',
      html: html || text || ''
    });
    console.log(`[Email Sent] ✅ Successfully sent to: ${to} (MessageId: ${info.messageId})`);
    return info;
  } catch (error) {
    console.error(`[Email Error] ❌ Failed to send email to ${to}:`, error.message);
    if (error.code === 'EAUTH') {
      console.error('[Email Error Hint] Authentication failed. Please verify EMAIL_USER and EMAIL_PASS in your .env file.');
    } else if (error.code === 'ESOCKET' || error.code === 'ETIMEDOUT') {
      console.error('[Email Error Hint] Connection timed out. Check EMAIL_HOST, EMAIL_PORT (465 vs 587), and firewall rules.');
    }
    return null;
  }
};

const verifyEmailConfig = async () => {
  if (!isEmailConfigured()) {
    return {
      configured: false,
      message: 'SMTP credentials (EMAIL_USER / EMAIL_PASS) are missing in .env.'
    };
  }

  try {
    const transporter = getTransporter();
    await transporter.verify();
    return {
      configured: true,
      success: true,
      message: 'SMTP connection verified successfully!'
    };
  } catch (err) {
    return {
      configured: true,
      success: false,
      error: err.message,
      code: err.code
    };
  }
};

module.exports = sendEmail;
module.exports.sendEmail = sendEmail;
module.exports.getTransporter = getTransporter;
module.exports.isEmailConfigured = isEmailConfigured;
module.exports.verifyEmailConfig = verifyEmailConfig;
