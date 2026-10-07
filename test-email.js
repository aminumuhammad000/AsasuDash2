require('dotenv').config();
const { sendEmail, verifyEmailConfig, isEmailConfigured } = require('./utils/email');

const runEmailDiagnostics = async () => {
  console.log('\n==================================================');
  console.log('       ASASU REALTY - EMAIL DIAGNOSTIC TOOL       ');
  console.log('==================================================\n');

  console.log('📋 Detected Environment Settings:');
  console.log('---------------------------------');
  console.log(`• EMAIL_HOST   : ${process.env.EMAIL_HOST || '(not set, default: smtp.hostinger.com)'}`);
  console.log(`• EMAIL_PORT   : ${process.env.EMAIL_PORT || '(not set, default: 465)'}`);
  console.log(`• EMAIL_SECURE : ${process.env.EMAIL_SECURE || '(auto: ' + ((process.env.EMAIL_PORT || '465') === '465') + ')'}`);
  console.log(`• EMAIL_USER   : ${process.env.EMAIL_USER || '❌ NOT SET'}`);
  console.log(`• EMAIL_PASS   : ${process.env.EMAIL_PASS ? '******** (set)' : '❌ NOT SET'}`);
  console.log(`• EMAIL_FROM   : ${process.env.EMAIL_FROM || (process.env.EMAIL_USER ? `"ASASU Realty" <${process.env.EMAIL_USER}>` : '❌ NOT SET')}`);
  console.log(`• ADMIN_EMAIL  : ${process.env.ADMIN_EMAIL || 'admin@asasurealty.com'}\n`);

  if (!isEmailConfigured()) {
    console.log('❌ SMTP IS NOT FULLY CONFIGURED IN YOUR .env FILE.');
    console.log('To enable OTP password resets and payment schedule notifications:');
    console.log('1. Open or create your `.env` file in the project root.');
    console.log('2. Add your Hostinger (or Gmail) SMTP credentials:');
    console.log('   EMAIL_HOST=smtp.hostinger.com');
    console.log('   EMAIL_PORT=465');
    console.log('   EMAIL_SECURE=true');
    console.log('   EMAIL_USER=your-email@asasurealty.com');
    console.log('   EMAIL_PASS=your-mailbox-password');
    console.log('   EMAIL_FROM="ASASU Realty" <your-email@asasurealty.com>');
    console.log('\nSee `.env.example` for details.\n');
    return;
  }

  console.log('🔍 Step 1: Testing SMTP Server Connection...');
  const verifyResult = await verifyEmailConfig();

  if (!verifyResult.success) {
    console.error('❌ SMTP Connection Failed!');
    console.error(`Error details: ${verifyResult.error} (Code: ${verifyResult.code || 'N/A'})\n`);

    if (verifyResult.code === 'EAUTH') {
      console.log('👉 HINT: Authentication failed. Please double-check EMAIL_USER and EMAIL_PASS.');
    } else if (verifyResult.code === 'ETIMEDOUT' || verifyResult.code === 'ESOCKET') {
      console.log('👉 HINT: Connection timed out. Verify your EMAIL_HOST and port (try 465 with EMAIL_SECURE=true or 587 with EMAIL_SECURE=false).');
    }
    return;
  }

  console.log('✅ SMTP Connection & Authentication Succeeded!\n');

  const targetEmail = process.argv[2] || process.env.EMAIL_USER;
  console.log(`📨 Step 2: Sending Test Email to: ${targetEmail}...`);

  const info = await sendEmail(
    targetEmail,
    'ASASU Realty Email Service Test ✅',
    'Hello! This is a test email confirming that your ASASU Realty email delivery system is functioning properly for OTP resets and schedule notifications.',
    `<div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
      <div style="border-bottom: 2px solid #e8b84b; padding-bottom: 12px; margin-bottom: 16px;">
        <h2 style="color: #1a1f3c; margin: 0;">ASASU REALTY LTD</h2>
        <span style="color: #64748b; font-size: 13px;">System Verification Test</span>
      </div>
      <p style="color: #334155; font-size: 15px;">Your SMTP configuration is active and working properly.</p>
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; margin: 16px 0;">
        <p style="margin: 0; color: #166534; font-weight: bold;">✔ OTP Password Resets: READY</p>
        <p style="margin: 6px 0 0 0; color: #166534; font-weight: bold;">✔ Schedule Notifications: READY</p>
        <p style="margin: 6px 0 0 0; color: #166534; font-weight: bold;">✔ Admin Claim Alerts: READY</p>
      </div>
      <p style="color: #64748b; font-size: 12px; margin-top: 20px;">Sent at: ${new Date().toISOString()}</p>
    </div>`
  );

  if (info && info.messageId) {
    console.log(`\n🎉 Test email sent successfully! (Message ID: ${info.messageId})`);
    console.log('Check the inbox (and spam folder) of ' + targetEmail + '.\n');
  } else {
    console.log('\n❌ Test email was not sent. Check the error log above.\n');
  }
};

runEmailDiagnostics();
