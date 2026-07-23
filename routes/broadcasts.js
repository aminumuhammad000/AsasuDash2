const express = require('express');
const router = express.Router();
const Broadcast = require('../models/Broadcast');
const User = require('../models/User');
const sendEmail = require('../utils/email');
const auth = require('../middleware/auth');

// Get all broadcasts
router.get('/', auth, async (req, res) => {
  try {
    const broadcasts = await Broadcast.find().sort({ createdAt: -1 }).limit(10);
    res.json(broadcasts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a broadcast (Admin only)
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
  try {
    const { title, message, type } = req.body;
    const broadcast = new Broadcast({
      title,
      message,
      type: type || 'info',
      createdBy: req.user.id
    });
    await broadcast.save();

    // Notify all via Socket.io
    const io = req.app.get('socketio');
    io.emit('notification', {
      type: 'broadcast',
      message: `Announcement: ${title}`
    });
    io.emit('new_broadcast', broadcast);
    
    // Send email notifications to all active partners
    try {
      const partners = await User.find({ role: { $in: ['partner', 'agent'] }, status: 'active' });
      const emailPromises = partners.map(partner => {
        return sendEmail(
          partner.email,
          `ASASU Portal: ${title}`,
          `Hello ${partner.name},\n\nA new announcement has been posted: ${title}\n\n${message}\n\nBest regards,\nASASU Realty LTD Team`,
          `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px;">
            <h2 style="color: #1a1f3c;">New Announcement</h2>
            <p>Hello <strong>${partner.name}</strong>,</p>
            <div style="background: #f7f8fc; padding: 15px; border-radius: 8px; border-left: 4px solid #e8b84b; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #1a1f3c;">${title}</h3>
              <p style="color: #444; line-height: 1.6;">${message}</p>
            </div>
            <p>Log in to your portal to see more details.</p>
            <p style="font-size: 12px; color: #888; margin-top: 30px;">Best regards,<br>ASASU Realty LTD Team</p>
          </div>`
        );
      });
      // We don't await all here to prevent blocking the response, or we can await for better reliability
      Promise.all(emailPromises).catch(err => console.error('Error sending broadcast emails:', err));
    } catch (emailErr) {
      console.error('Failed to process broadcast emails:', emailErr);
    }

    res.status(201).json(broadcast);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Send message to specific partner (Admin only)
router.post('/specific', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
  try {
    const { identifier, message } = req.body;
    
    // Find partner by email or name (identifier)
    const partner = await User.findOne({ 
      role: { $in: ['partner', 'agent'] }, 
      $or: [
        { email: identifier },
        { name: new RegExp('^' + identifier + '$', 'i') }
      ]
    });

    if (!partner) return res.status(404).json({ error: 'Partner not found' });

    // Notify via Socket.io if online
    const io = req.app.get('socketio');
    io.to(partner._id.toString()).emit('notification', {
      type: 'direct_message',
      message: `Message from Admin: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`
    });

    // Send email
    await sendEmail(
      partner.email,
      'ASASU Portal: New Message from Admin',
      `Hello ${partner.name},\n\nYou have received a direct message from the ASASU Admin:\n\n${message}\n\nBest regards,\nASASU Realty LTD Team`,
      `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px;">
        <h2 style="color: #1a1f3c;">Direct Message from Admin</h2>
        <p>Hello <strong>${partner.name}</strong>,</p>
        <div style="background: #f7f8fc; padding: 15px; border-radius: 8px; border-left: 4px solid #1a1f3c; margin: 20px 0;">
          <p style="color: #444; line-height: 1.6;">${message}</p>
        </div>
        <p>Log in to your portal to respond or see more details.</p>
        <p style="font-size: 12px; color: #888; margin-top: 30px;">Best regards,<br>ASASU Realty LTD Team</p>
      </div>`
    );

    res.json({ message: 'Message sent successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
