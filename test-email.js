require('dotenv').config();
const sendEmail = require('./utils/email');

const testEmail = async () => {
    console.log('--- Email Connection Test ---');
    console.log(`Host: ${process.env.EMAIL_HOST}`);
    console.log(`User: ${process.env.EMAIL_USER}`);
    console.log(`Secure: ${process.env.EMAIL_SECURE}`);
    
    try {
        const recipient = process.argv[2] || process.env.EMAIL_USER;
        console.log(`Sending test email to: ${recipient}...`);
        
        const result = await sendEmail(
            recipient,
            'ASASU System Test ✅',
            'If you are reading this, your Hostinger SMTP configuration is working perfectly!',
            '<h1>ASASU Realty System Test</h1><p style="color: green;"><b>SUCCESS:</b> Your email system is now 100% configured and working.</p>'
        );
        
        if (result) {
            console.log('✅ Success! Message ID:', result.messageId);
        } else {
            console.log('❌ Failed: Check console for logs above.');
        }
    } catch (err) {
        console.error('❌ Error during test:', err);
    }
};

testEmail();
