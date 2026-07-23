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
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    // Default status is active for the first admin, pending_approval for others
    const userCount = await User.countDocuments();
    let status = 'pending_approval';
    
    // First user is always active admin and verified
    const isVerified = (userCount === 0);
    if (userCount === 0) {
      status = 'active';
    }

    const user = new User({ 
      email, 
      password: hashedPassword, 
      name, 
      role: (userCount === 0) ? 'admin' : 'partner',
      status,
      isVerified,
      otp,
      otpExpires
    });
    
    await user.save();

    // Send OTP Email if not first admin
    if (!isVerified) {
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            .email-container { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e1e4e8; border-radius: 12px; overflow: hidden; color: #1a1f3c; }
            .header { background: #1a1f3c; padding: 30px; text-align: center; }
            .logo { font-size: 24px; font-weight: bold; color: #e8b84b; text-decoration: none; }
            .content { padding: 40px 30px; line-height: 1.6; background: #ffffff; }
            .otp-box { background: #f7f8fc; padding: 25px; text-align: center; border-radius: 8px; margin: 30px 0; border: 1px dashed #e8b84b; }
            .otp-code { font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #1a1f3c; margin: 0; }
            .footer { background: #f7f8fc; padding: 20px; text-align: center; font-size: 12px; color: #888; border-top: 1px solid #e1e4e8; }
            .btn { display: inline-block; padding: 12px 24px; background: #e8b84b; color: #1a1f3c; text-decoration: none; border-radius: 6px; font-weight: 700; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <div class="logo">🏠 ASASU REALTY</div>
            </div>
            <div class="content">
              <h2 style="margin-top:0">Welcome to the Portal, ${name}!</h2>
              <p>To finalize your registration and begin tracking your commissions, please verify your email address using the code below:</p>
              <div class="otp-box">
                <p style="margin:0 0 10px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #888;">Your Verification Code</p>
                <div class="otp-code">${otp}</div>
              </div>
              <p>This code is valid for <strong>10 minutes</strong>. If you didn't create an account, you can safely ignore this email.</p>
            </div>
            <div class="footer">
              &copy; 2026 ASASU Realty LTD. All rights reserved.<br>
              Professional Commission Management for Real Estate Partners.
            </div>
          </div>
        </body>
        </html>
      `;
      await sendEmail(
        email,
        'Verify your ASASU Portal Account',
        `Hello ${name}, Your verification code is: ${otp}`,
        emailHtml
      );
    }

    res.status(201).json({ 
      message: isVerified ? 'User created' : 'Registration submitted. Please verify your email with the OTP sent.',
      status,
      needsVerification: !isVerified
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

    const token = jwt.sign({ id: user._id, role: user.role, name: user.name }, process.env.JWT_SECRET, { expiresIn: '1d' });
    
    // Update lastActive
    user.lastActive = new Date();
    await user.save();

    // Normalize role to the frontend expected format (uppercase role strings)
    const mapRole = (r) => {
      if (!r) return 'PARTNER';
      if (r === 'admin') return 'ADMIN';
      if (r === 'agent') return 'AGENT';
      if (r === 'sub_developer' || r === 'sub-developer' || r === 'subdeveloper') return 'SUB_DEVELOPER';
      return String(r).toUpperCase();
    };

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
