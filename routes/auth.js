const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const sendEmail = require('../utils/email');
const router = express.Router();

// Helper to generate 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    
    // Check if user exists
    const existingUser = await User.findOne({ email: email ? email.toLowerCase() : "" });
    if (existingUser) return res.status(400).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const userCount = await User.countDocuments();
    const assignedRole = role || (userCount === 0 ? 'admin' : 'partner');

    const user = new User({ 
      email: email.toLowerCase(), 
      password: hashedPassword, 
      name, 
      role: assignedRole,
      status: 'active',
      isVerified: true
    });
    
    await user.save();

    const mapRole = (r) => {
      if (!r) return 'PARTNER';
      if (r === 'admin') return 'ADMIN';
      if (r === 'agent') return 'AGENT';
      if (r === 'sub_developer' || r === 'sub-developer' || r === 'subdeveloper') return 'SUB_DEVELOPER';
      return String(r).toUpperCase();
    };

    const token = jwt.sign(
      { sub: user._id.toString(), id: user._id.toString(), email: user.email, role: mapRole(user.role), name: user.name },
      process.env.JWT_SECRET || 'asasudash_secret_2026',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: mapRole(user.role),
      agency: user.agency || null,
      branch: user.branch || null,
      phone: user.phone || null,
      active: true,
      createdAt: user.createdAt ? user.createdAt.toISOString() : new Date().toISOString()
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isVerified) return res.status(400).json({ error: 'Account already verified' });

    if (user.otp !== otp || user.otpExpires < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    user.isVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    // Notify admins about new partner waiting for approval
    const { notifyAdmins } = require('../utils/notifications');
    await notifyAdmins(
      'Action Required: New Partner Registration',
      `A new partner application has been submitted by ${user.name} (${user.email}). They are currently waiting for your approval in the admin portal.`,
      `<div style="font-family: sans-serif; max-width: 600px; padding: 20px; border: 1px solid #1a1f3c; border-radius: 10px;">
        <h2 style="color: #1a1f3c;">New Partner Registration</h2>
        <p>A new partner has verified their email and is now <strong>awaiting your approval</strong>.</p>
        <div style="background: #f7f8fc; padding: 15px; border-radius: 8px; margin: 15px 0;">
          <p><strong>Name:</strong> ${user.name}</p>
          <p><strong>Email:</strong> ${user.email}</p>
          <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
        </div>
        <p>Please log in to the admin portal to approve or reject this application.</p>
        <a href="${process.env.FRONTEND_URL || '#'}" style="display: inline-block; padding: 10px 20px; background: #e8b84b; color: #1a1f3c; text-decoration: none; border-radius: 5px; font-weight: bold;">Open Portal</a>
      </div>`
    );

    res.json({ message: 'Email verified successfully! You can now log in after admin approval.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resend OTP
router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isVerified) return res.status(400).json({ error: 'Account already verified' });

    const otp = generateOTP();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await sendEmail(
      email,
      'Your New Verification Code',
      `Your new code is: ${otp}`,
      `<div style="font-family: sans-serif; text-align: center;">
        <h2>New Verification Code</h2>
        <p>Use this code to verify your account:</p>
        <h1 style="color: #e8b84b; letter-spacing: 5px;">${otp}</h1>
      </div>`
    );

    res.json({ message: 'A new OTP has been sent to your email.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'User not found' });

    if (!user.isVerified && user.role !== 'admin') {
      return res.status(403).json({ 
        error: 'Your email is not verified.', 
        needsVerification: true,
        email: user.email 
      });
    }

    if (user.status === 'pending_approval') {
      return res.status(403).json({ error: 'Your account is awaiting admin approval.' });
    }
    if (user.status === 'disabled') {
      return res.status(403).json({ error: 'Your account has been disabled.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    // Normalize role to the frontend expected format (uppercase role strings)
    const mapRole = (r) => {
      if (!r) return 'PARTNER';
      if (r === 'admin') return 'ADMIN';
      if (r === 'agent') return 'AGENT';
      if (r === 'sub_developer' || r === 'sub-developer' || r === 'subdeveloper') return 'SUB_DEVELOPER';
      return String(r).toUpperCase();
    };

    const token = jwt.sign(
      { sub: user._id.toString(), id: user._id.toString(), email: user.email, role: mapRole(user.role), name: user.name },
      process.env.JWT_SECRET || 'asasudash_secret_2026',
      { expiresIn: '7d' }
    );

    // Return flattened AuthUser shape expected by the frontend
    res.json({
      token,
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: mapRole(user.role),
      agency: user.agency || null,
      branch: user.branch || null,
      phone: user.phone || null,
      active: user.status === 'active',
      createdAt: user.createdAt ? user.createdAt.toISOString() : new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const auth = require('../middleware/auth');

// Change Password
router.post('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Current password incorrect' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
