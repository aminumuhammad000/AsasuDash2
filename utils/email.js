const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.mailtrap.io',
  port: parseInt(process.env.EMAIL_PORT) || 2525,
  secure: process.env.EMAIL_SECURE === 'true', // Use SSL/TLS for port 465
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const sendEmail = async (to, subject, text, html) => {
  // If email is not configured, skip sending but log it
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || process.env.EMAIL_USER === 'your-email@gmail.com') {
    console.log('Skipping email send: SMTP not configured in .env');
    console.log(`To: ${to}, Subject: ${subject}`);
    return null;
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || '"ASASU Portal" <notifications@asasurealty.com>',
      to,
      subject,
      text,
      html
    });
    console.log('Email sent: %s', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending email:', error);
    // Don't throw, just log. We don't want to break the app if email fails.
  }
};

module.exports = sendEmail;
