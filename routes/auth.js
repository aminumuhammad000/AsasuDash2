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

    const portal = req.body.portal || (req.path.includes('admin') ? 'admin' : (req.path.includes('user') ? 'user' : null));
    const userRole = String(user.role || '').toLowerCase();
    const isAdminRole = userRole === 'admin' || userRole === 'super_admin';

    if (portal === 'admin' && !isAdminRole) {
      return res.status(403).json({ error: 'Access denied. This account does not have administrative privileges. Please use the Partner sign in.' });
    }
    if (portal === 'user' && isAdminRole) {
      return res.status(403).json({ error: 'This account has administrative privileges. Please use the Admin Portal sign in.' });
    }

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

const fs = require('fs');
const path = require('path');

const syncStorePassword = (email, hashedPassword) => {
  try {
    const storePath = path.resolve(__dirname, '../ASASU_Commission_Portal/data/store.json');
    if (fs.existsSync(storePath)) {
      const storeData = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      const u = storeData.users?.find(item => item.email?.toLowerCase() === email.toLowerCase());
      if (u) {
        u.passwordHash = hashedPassword;
        delete u.otp;
        delete u.otpExpires;
        fs.writeFileSync(storePath, JSON.stringify(storeData, null, 2));
      }
    }
  } catch (err) {
    console.warn('Could not sync password to store.json:', err.message);
  }
};

const syncStoreOtp = (email, otp, otpExpires) => {
  try {
    const storePath = path.resolve(__dirname, '../ASASU_Commission_Portal/data/store.json');
    if (fs.existsSync(storePath)) {
      const storeData = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      const u = storeData.users?.find(item => item.email?.toLowerCase() === email.toLowerCase());
      if (u) {
        u.otp = otp;
        u.otpExpires = otpExpires;
        fs.writeFileSync(storePath, JSON.stringify(storeData, null, 2));
      }
    }
  } catch (err) {
    console.warn('Could not sync OTP to store.json:', err.message);
  }
};

// Forgot Password - Send OTP
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Please enter your email address' });

    const emailNorm = email.toLowerCase().trim();
    const user = await User.findOne({ email: emailNorm });

    // Also check store.json if user not found in Mongo
    let storeUser = null;
    try {
      const storePath = path.resolve(__dirname, '../ASASU_Commission_Portal/data/store.json');
      if (fs.existsSync(storePath)) {
        const storeData = JSON.parse(fs.readFileSync(storePath, 'utf8'));
        storeUser = storeData.users?.find(u => u.email?.toLowerCase() === emailNorm);
      }
    } catch {}

    if (!user && !storeUser) {
      return res.status(404).json({ error: 'No account found with this email address' });
    }

    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000);

    if (user) {
      user.otp = otp;
      user.otpExpires = otpExpires;
      await user.save();
    }

    syncStoreOtp(emailNorm, otp, otpExpires.toISOString());

    const recipientName = user?.name || storeUser?.name || 'Partner';
    await sendEmail(
      emailNorm,
      'Your ASASU Password Reset Code',
      `Your password reset code is: ${otp}. It will expire in 15 minutes.`,
      `<div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #1a1f3c; margin: 0; font-size: 22px;">ASASU REALTY LTD</h2>
          <span style="color: #64748b; font-size: 13px;">Partner Portal Account Security</span>
        </div>
        <p style="color: #334155; font-size: 15px; line-height: 1.5;">Hello ${recipientName},</p>
        <p style="color: #334155; font-size: 14px; line-height: 1.5;">We received a request to reset your password. Use the verification code below to set a new password:</p>
        <div style="background: #f8fafc; border: 2px dashed #e8b84b; border-radius: 10px; padding: 18px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #1a1f3c;">${otp}</span>
        </div>
        <p style="color: #64748b; font-size: 13px; line-height: 1.5;">This code expires in 15 minutes. If you did not request this password reset, please ignore this email.</p>
      </div>`
    );

    res.json({ ok: true, message: `A 6-digit verification code has been sent to ${emailNorm}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset Password with OTP
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'Email, verification code, and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const emailNorm = email.toLowerCase().trim();
    const user = await User.findOne({ email: emailNorm });

    let storeUser = null;
    let storeData = null;
    const storePath = path.resolve(__dirname, '../ASASU_Commission_Portal/data/store.json');
    try {
      if (fs.existsSync(storePath)) {
        storeData = JSON.parse(fs.readFileSync(storePath, 'utf8'));
        storeUser = storeData.users?.find(u => u.email?.toLowerCase() === emailNorm);
      }
    } catch {}

    if (!user && !storeUser) {
      return res.status(404).json({ error: 'User account not found' });
    }

    const expectedOtp = user?.otp || storeUser?.otp;
    const expiry = user?.otpExpires || (storeUser?.otpExpires ? new Date(storeUser.otpExpires) : null);

    if (!expectedOtp || expectedOtp !== otp.trim()) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    if (expiry && new Date(expiry).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    if (user) {
      user.password = hashedPassword;
      user.otp = undefined;
      user.otpExpires = undefined;
      await user.save();
    }

    syncStorePassword(emailNorm, hashedPassword);

    res.json({ ok: true, message: 'Your password has been successfully reset. You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change Password
router.post('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const targetId = req.user.id || req.user.sub;
    let user = null;
    if (targetId) {
      user = await User.findById(targetId).catch(() => null);
    }
    if (!user && req.user.email) {
      user = await User.findOne({ email: req.user.email.toLowerCase() });
    }

    let storeUser = null;
    const storePath = path.resolve(__dirname, '../ASASU_Commission_Portal/data/store.json');
    if (fs.existsSync(storePath)) {
      try {
        const storeData = JSON.parse(fs.readFileSync(storePath, 'utf8'));
        storeUser = storeData.users?.find(u => u.id === targetId || u.email?.toLowerCase() === req.user.email?.toLowerCase());
      } catch {}
    }

    if (!user && !storeUser) return res.status(404).json({ error: 'User not found' });

    let isMatch = false;
    if (user) {
      isMatch = await bcrypt.compare(currentPassword, user.password);
    } else if (storeUser?.passwordHash) {
      isMatch = await bcrypt.compare(currentPassword, storeUser.passwordHash);
    }

    if (!isMatch) return res.status(400).json({ error: 'Current password incorrect' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    if (user) {
      user.password = hashedPassword;
      await user.save();
    }

    syncStorePassword(req.user.email || user?.email || storeUser?.email, hashedPassword);

    res.json({ ok: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
