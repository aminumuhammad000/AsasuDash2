const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  ref: { type: String, required: true, unique: true },
  partner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  partnerCode: { type: String },
  partnerName: { type: String },
  email: { type: String },
  count: { type: Number, required: true },
  file: { type: String, required: true },
  fileId: { type: String },
  fileSize: { type: String, required: true },
  status: { type: String, enum: ['pending', 'paid', 'rejected', 'approved'], default: 'pending' },
  notes: { type: String },
  date: { type: Date, default: Date.now },
  replies: [{
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    senderName: { type: String },
    senderRole: { type: String },
    message: { type: String },
    createdAt: { type: Date, default: Date.now }
  }]
});

module.exports = mongoose.model('Submission', submissionSchema);

