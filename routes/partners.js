const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const auth = require('../middleware/auth');
const bcrypt = require('bcryptjs');

const isAdmin = (role) => {
  const r = String(role || '').toLowerCase();
  return r === 'admin' || r === 'super_admin';
};

// Get all partners (Admin only)
router.get('/', auth, async (req, res) => {
  if (!isAdmin(req.user.role)) {
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
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Access denied' });
  try {
    const { status } = req.body;
    const partner = await User.findByIdAndUpdate(req.params.id, { status }, { new: true });
    
    // Notify partner via Socket.io if possible
    const io = req.app.get('socketio');
    if (io && partner) {
      io.to(partner._id.toString()).emit('notification', {
        type: 'account_status',
        message: `Your account status has been updated to: ${status}`
      });
    }

    res.json(partner);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Create new admin, staff, or partner (Admin only)
router.post('/', auth, async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Access denied. Administrator privileges required.' });
  try {
    const { name, email, password, role, agency, branch, phone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ error: 'A user with this email address already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const assignedRole = (role || 'admin').toLowerCase();

    const newUser = new User({
      name,
      email: normalizedEmail,
      password: hashedPassword,
      role: assignedRole,
      status: 'active',
      isVerified: true
    });
    await newUser.save();

    // Also sync to store.json
    try {
      const storePath = path.resolve(__dirname, '../ASASU_Commission_Portal/data/store.json');
      if (fs.existsSync(storePath)) {
        const storeData = JSON.parse(fs.readFileSync(storePath, 'utf8'));
        const mappedRole = (r) => {
          const upper = String(r || '').toUpperCase();
          if (['SUPER_ADMIN', 'ADMIN', 'FINANCE', 'OPERATIONS', 'AUDITOR', 'SUPPORT', 'BRANCH_ADMIN', 'AGENT', 'SUB_DEVELOPER'].includes(upper)) {
            return upper;
          }
          if (upper === 'PARTNER') return 'AGENT';
          return 'ADMIN';
        };

        const storeUser = {
          id: `usr_${Date.now()}`,
          name,
          email: normalizedEmail,
          role: mappedRole(role),
          agency: agency || (['ADMIN', 'SUPER_ADMIN', 'FINANCE', 'OPERATIONS'].includes(mappedRole(role)) ? 'ASASU Realty' : 'Direct Partner'),
          branch: branch || undefined,
          phone: phone || undefined,
          active: true,
          createdAt: new Date().toISOString(),
          passwordHash: hashedPassword
        };
        storeData.users = storeData.users || [];
        if (!storeData.users.some(u => u.email.toLowerCase() === normalizedEmail)) {
          storeData.users.push(storeUser);
          fs.writeFileSync(storePath, JSON.stringify(storeData, null, 2));
        }
      }
    } catch (storeErr) {
      console.warn('Could not sync created user to store.json:', storeErr.message);
    }

    res.status(201).json({
      message: `User ${name} created successfully.`,
      user: {
        id: newUser._id.toString(),
        name: newUser.name,
        email: newUser.email,
        role: newUser.role
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete partner / user (Admin only)
router.delete('/:id', auth, async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Access denied' });
  const targetId = req.params.id;
  const currentUserId = req.user.id || req.user.sub || req.user._id;

  if (currentUserId && String(currentUserId) === String(targetId)) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }

  try {
    let partner = null;
    if (mongoose.Types.ObjectId.isValid(targetId)) {
      partner = await User.findByIdAndDelete(targetId);
    } else {
      partner = await User.findOneAndDelete({ $or: [{ _id: targetId }, { email: targetId.toLowerCase() }] }).catch(() => null);
    }

    let deletedFromStore = null;
    try {
      const storePath = path.resolve(__dirname, '../ASASU_Commission_Portal/data/store.json');
      if (fs.existsSync(storePath)) {
        const storeData = JSON.parse(fs.readFileSync(storePath, 'utf8'));
        const uIdx = storeData.users?.findIndex(u => u.id === targetId || (partner && u.email?.toLowerCase() === partner.email?.toLowerCase()));
        if (uIdx !== undefined && uIdx !== -1) {
          deletedFromStore = storeData.users[uIdx];
          storeData.users.splice(uIdx, 1);
          if (storeData.notifications) {
            storeData.notifications = storeData.notifications.filter(n => n.userId !== targetId);
          }
          fs.writeFileSync(storePath, JSON.stringify(storeData, null, 2));
        }
      }
    } catch (storeErr) {
      console.warn('Could not sync user deletion to store.json:', storeErr.message);
    }

    if (!partner && !deletedFromStore) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userName = partner?.name || deletedFromStore?.name || 'User';
    res.json({ ok: true, message: `User ${userName} has been deleted successfully.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Reset Partner Password
router.patch('/:id/reset-password', auth, async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Access denied' });
  try {
    const { newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: 'New password is required' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const partner = await User.findByIdAndUpdate(req.params.id, { password: hashedPassword });

    try {
      const storePath = path.resolve(__dirname, '../ASASU_Commission_Portal/data/store.json');
      if (fs.existsSync(storePath)) {
        const storeData = JSON.parse(fs.readFileSync(storePath, 'utf8'));
        const u = storeData.users?.find(item => item.id === req.params.id || (partner && item.email?.toLowerCase() === partner.email?.toLowerCase()));
        if (u) {
          u.passwordHash = hashedPassword;
          fs.writeFileSync(storePath, JSON.stringify(storeData, null, 2));
        }
      }
    } catch (storeErr) {
      console.warn('Could not sync password reset to store.json:', storeErr.message);
    }

    if (!partner) return res.status(404).json({ error: 'Partner not found' });

    res.json({ message: `Password for ${partner.name} has been reset successfully.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

