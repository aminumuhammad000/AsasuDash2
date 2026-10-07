const Setting = require('../models/Setting');
const sendEmail = require('./email');

const mongoose = require('mongoose');

/**
 * Sends a notification email to all admin notification addresses saved in settings
 */
const notifyAdmins = async (subject, text, html) => {
  try {
    let setting = null;
    try {
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        setting = await Setting.findOne({ key: 'admin_notification_emails' });
      }
    } catch (dbErr) {
      console.warn('[Notification Warning] Could not query Setting from MongoDB:', dbErr.message);
    }
    
    let recipientList = process.env.ADMIN_EMAIL || 'admin@asasurealty.com';
    
    if (setting && setting.value) {
      recipientList = setting.value;
    }

    // Handle string or array format
    const recipients = Array.isArray(recipientList) 
      ? recipientList 
      : recipientList.split(',').map(e => e.trim()).filter(e => e);

    if (!recipients.includes('admin@asasurealty.com')) {
      recipients.push('admin@asasurealty.com');
    }

    if (!recipients.length) {
      console.log('No admin notification emails configured.');
      return;
    }

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
