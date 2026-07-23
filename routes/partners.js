const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');
const bcrypt = require('bcryptjs');

// Get all partners (Admin only)
router.get('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied.' });
  }
  try {
    const status = req.query.status;
    let query = { role: { $in: ['partner', 'agent', 'sub_developer'] } };
    if (status) query.status = status;
    
    const partners = await User.find(query).select('-password');
    res.json(partners);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update partner status (Approve/Disable)
router.patch('/:id/status', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
  try {
    const { status } = req.body;
    const partner = await User.findByIdAndUpdate(req.params.id, { status }, { new: true });
    
    // Notify partner via Socket.io if possible
    const io = req.app.get('socketio');
    io.to(partner._id.toString()).emit('notification', {
      type: 'account_status',
      message: `Your account status has been updated to: ${status}`
    });

    res.json(partner);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete partner (Admin only)
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
  try {
    const partner = await User.findByIdAndDelete(req.params.id);
    if (!partner) return res.status(404).json({ error: 'Partner not found' });
    res.json({ message: `Partner ${partner.name} has been deleted successfully.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Reset Partner Password
router.patch('/:id/reset-password', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
  try {
    const { newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: 'New password is required' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const partner = await User.findByIdAndUpdate(req.params.id, { password: hashedPassword });

    if (!partner) return res.status(404).json({ error: 'Partner not found' });

    res.json({ message: `Password for ${partner.name} has been reset successfully.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
