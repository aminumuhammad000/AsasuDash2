const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  role: { 
    type: String, 
    enum: [
      'partner', 'admin', 'agent', 'sub_developer',
      'PARTNER', 'ADMIN', 'AGENT', 'SUB_DEVELOPER',
      'SUPER_ADMIN', 'OPERATIONS', 'BRANCH_ADMIN', 'FINANCE', 'SUPPORT', 'AUDITOR'
    ], 
    default: 'partner' 
  },
  status: { type: String, enum: ['pending_approval', 'active', 'disabled'], default: 'active' },
  isVerified: { type: Boolean, default: true },
  otp: { type: String },
  otpExpires: { type: Date },
  lastActive: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
