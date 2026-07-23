const Setting = require('../models/Setting');
const sendEmail = require('./email');

/**
 * Sends a notification email to all admin notification addresses saved in settings
 */
const notifyAdmins = async (subject, text, html) => {
  try {
    const setting = await Setting.findOne({ key: 'admin_notification_emails' });
    
    // Default to the .env ADMIN_EMAIL if no settings exist yet
    let recipientList = process.env.ADMIN_EMAIL || '';
    
    if (setting && setting.value) {
      recipientList = setting.value;
    }

    if (!recipientList) {
      console.log('No admin notification emails configured.');
      return;
    }

    // Handle string or array format
    const recipients = Array.isArray(recipientList) 
      ? recipientList 
      : recipientList.split(',').map(e => e.trim()).filter(e => e);

    console.log(`Sending admin notification to: ${recipients.join(', ')}`);

    const emailPromises = recipients.map(email => {
      return sendEmail(email, subject, text, html);
    });

    await Promise.all(emailPromises);
  } catch (err) {
    console.error('Error in notifyAdmins:', err);
  }
};

module.exports = { notifyAdmins };
