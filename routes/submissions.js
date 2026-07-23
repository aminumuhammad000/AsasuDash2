const express = require('express');
const router = express.Router();
const Submission = require('../models/Submission');
const auth = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const ExcelJS = require('exceljs');
const sendEmail = require('../utils/email');
const cloudinary = require('../utils/cloudinary');
const fs = require('fs');

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/claims/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Get all submissions (Admin) or User's submissions (Partner)
router.get('/', auth, async (req, res) => {
  try {
    let query = {};
    if (req.user.role !== 'admin') {
      query.partner = req.user.id;
    }
    const submissions = await Submission.find(query).populate('partner', 'name').sort({ date: -1 });
    
    // Ensure partnerName is populated if missing (for older records)
    const formattedSubmissions = submissions.map(s => {
      const obj = s.toObject();
      if (!obj.partnerName && obj.partner) {
        obj.partnerName = obj.partner.name;
      }
      return obj;
    });
    
    res.json(formattedSubmissions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export to Excel (Admin only)
router.get('/export', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });

  try {
    const submissions = await Submission.find({ status: 'paid' });
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Paid Claims');

    worksheet.columns = [
      { header: 'Reference', key: 'ref', width: 15 },
      { header: 'Partner Name', key: 'partnerName', width: 20 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Applicants', key: 'count', width: 10 },
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Status', key: 'status', width: 10 }
    ];

    submissions.forEach(s => {
      worksheet.addRow({
        ref: s.ref,
        partnerName: s.partnerName,
        email: s.email,
        count: s.count,
        date: s.date.toISOString().split('T')[0],
        status: s.status
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=paid_claims.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', [auth, upload.single('file')], async (req, res) => {
  try {
    const { ref, partnerCode, partnerName, email, count, notes } = req.body;
    let fileUrl = 'no-file';
    let fileId = null;

    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        resource_type: 'raw',
        folder: 'asasu/claims',
        public_id: Date.now() + '-' + req.file.originalname.split('.')[0]
      });
      fileUrl = result.secure_url;
      fileId = result.public_id;
      
      // Delete local file after upload
      fs.unlinkSync(req.file.path);
    }

    const submission = new Submission({
      ref,
      partner: req.user.id,
      partnerCode,
      partnerName,
      email,
      count: parseInt(count),
      file: fileUrl,
      fileId: fileId, // Store this in case we need to delete/replace it later
      fileSize: req.file ? (req.file.size / 1024).toFixed(1) + ' KB' : '0 KB',
      notes
    });
    await submission.save();

    // Notify admins about new claim
    try {
      const { notifyAdmins } = require('../utils/notifications');
      await notifyAdmins(
        `New Claim Submitted: ${ref}`,
        `Partner ${partnerName} has submitted a new commission claim (${ref}) with ${count} applicants.`,
        `<div style="font-family: sans-serif; max-width: 600px; padding: 20px; border: 1px solid #1a1f3c; border-radius: 10px;">
          <h2 style="color: #1a1f3c;">New Commission Claim</h2>
          <p>Partner <strong>${partnerName}</strong> has submitted a new claim.</p>
          <div style="background: #f7f8fc; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <p><strong>Ref:</strong> ${ref}</p>
            <p><strong>Applicants:</strong> ${count}</p>
            <p><strong>Partner Code:</strong> ${partnerCode || 'N/A'}</p>
          </div>
          <p>Please log in to the portal to review the supporting documents and approve/reject.</p>
        </div>`
      );
    } catch (notifErr) {
      console.error('Failed to notify admins of new claim:', notifErr);
    }

    res.status(201).json(submission);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update status (Admin only) with Socket.io notification
router.patch('/:ref/status', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Admins only.' });
  }
  try {
    const { status } = req.body;
    const submission = await Submission.findOneAndUpdate(
      { ref: req.params.ref }, 
      { status }, 
      { returnDocument: 'after' }
    );
    if (!submission) return res.status(404).json({ error: 'Claim not found' });

    // Send real-time notification
    const io = req.app.get('socketio');
    io.to(submission.partner.toString()).emit('notification', {
      type: 'status_update',
      message: `Your claim ${submission.ref} has been ${status}.`,
      ref: submission.ref,
      status: status
    });

    // Send email notification
    let subject = `Commission Claim ${status.toUpperCase()}: ${submission.ref}`;
    let text = `Hello ${submission.partnerName || 'Partner'},\n\nYour commission claim ${submission.ref} has been ${status}.\n\nLog in to the portal for details.`;
    let html = `<h3>Claim Update</h3><p>Hello <b>${submission.partnerName || 'Partner'}</b>,</p><p>Your commission claim <b>${submission.ref}</b> has been <b>${status}</b>.</p><p>Please log in to the portal for more details.</p>`;

    if (status === 'paid') {
      subject = `Commission Claim Paid: ${submission.ref} — ASASU REALTY LTD`;
      text = `Dear Partner,

We are pleased to inform you that your commission claim with reference number ${submission.ref} has been successfully processed and paid.

Kindly check your account balance. Payments are usually credited instantly. If you do not receive your credit alert within a short period, please do not hesitate to contact our support team for assistance.

Thank you for your continued trust and partnership with ASASU REALTY LTD. We truly appreciate your support and the confidence you place in our services.

Your success is important to us, and we remain committed to providing a seamless, transparent, and rewarding partnership experience. We look forward to continuing our successful relationship and supporting your growth every step of the way.

Best regards,

Finance Department
ASASU REALTY LTD`;

      html = `
        <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;color:#1a1f3c;line-height:1.8;max-width:620px;margin:auto;border:1px solid #dce1ec;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.08);">
          <!-- Header -->
          <div style="background:linear-gradient(135deg,#1a1f3c 0%,#243354 100%);padding:36px 30px;text-align:center;">
            <p style="margin:0 0 8px 0;color:#e8b84b;font-size:12px;letter-spacing:3px;text-transform:uppercase;font-weight:600;">ASASU REALTY LTD</p>
            <h1 style="color:#ffffff;margin:0;font-size:26px;font-weight:700;letter-spacing:0.5px;">Commission Payment Confirmed</h1>
            <p style="margin:10px 0 0 0;color:#a0aac4;font-size:13px;">Your claim has been successfully processed</p>
          </div>

          <!-- Success Badge -->
          <div style="background:#f0faf4;padding:20px 30px;text-align:center;border-bottom:1px solid #d4edda;">
            <span style="display:inline-block;background:#27ae60;color:#fff;font-size:13px;font-weight:700;padding:8px 24px;border-radius:50px;letter-spacing:1px;">✓ PAID</span>
            <p style="margin:10px 0 0 0;color:#1e7e34;font-size:13px;font-weight:500;">Reference: <strong>${submission.ref}</strong></p>
          </div>

          <!-- Body -->
          <div style="padding:40px 36px;background:#ffffff;">
            <p style="font-size:15px;font-weight:500;color:#2d3748;margin:0 0 16px 0;">Dear ${submission.partnerName || 'Partner'},</p>

            <p style="font-size:15px;color:#4a5568;margin:0 0 20px 0;">
              We are pleased to inform you that your commission claim with reference number
              <strong style="color:#1a1f3c;">${submission.ref}</strong> has been successfully processed and
              <span style="color:#27ae60;font-weight:700;">paid</span>.
            </p>

            <div style="background:#fffbf0;border-left:4px solid #e8b84b;padding:18px 20px;margin:24px 0;border-radius:0 8px 8px 0;">
              <p style="margin:0;font-size:14px;color:#5a4a1a;line-height:1.7;">
                <strong>📌 Note:</strong> Kindly check your account balance. Payments are usually credited instantly.
                If you do not receive your credit alert within a short period, please do not hesitate to contact
                our support team for assistance.
              </p>
            </div>

            <p style="font-size:15px;color:#4a5568;margin:20px 0;">
              Thank you for your continued trust and partnership with <strong style="color:#1a1f3c;">ASASU REALTY LTD</strong>.
              We truly appreciate your support and the confidence you place in our services.
            </p>

            <p style="font-size:15px;color:#4a5568;margin:0 0 30px 0;">
              Your success is important to us, and we remain committed to providing a seamless, transparent, and rewarding
              partnership experience. We look forward to continuing our successful relationship and supporting your growth every step of the way.
            </p>

            <!-- Signature -->
            <div style="margin-top:32px;padding-top:24px;border-top:1px solid #edf2f7;">
              <p style="margin:0;color:#9aa5b4;font-size:13px;">Best regards,</p>
              <p style="margin:6px 0 2px 0;color:#1a1f3c;font-weight:700;font-size:16px;">Finance Department</p>
              <p style="margin:0;color:#4a5568;font-size:14px;font-weight:500;">ASASU REALTY LTD</p>
            </div>
          </div>

          <!-- Footer -->
          <div style="background:#f7f8fc;padding:20px 30px;text-align:center;border-top:1px solid #edf2f7;">
            <p style="margin:0;font-size:12px;color:#a0aac4;">&copy; ${new Date().getFullYear()} ASASU REALTY LTD. All rights reserved.</p>
            <p style="margin:6px 0 0 0;font-size:11px;color:#c4cad8;">This is an automated message. Please do not reply directly to this email.</p>
          </div>
        </div>
      `;
    }
    
    if (submission.email) {
      await sendEmail(submission.email, subject, text, html);
    }

    res.json(submission);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete submission (Admin only)
router.delete('/:ref', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Admins only.' });
  }
  try {
    const submission = await Submission.findOneAndDelete({ ref: req.params.ref });
    if (!submission) return res.status(404).json({ error: 'Claim not found' });
    
    // Optionally delete from cloudinary if needed
    if (submission.fileId) {
      await cloudinary.uploader.destroy(submission.fileId, { resource_type: 'raw' });
    }
    
    res.json({ message: 'Claim deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a reply to a claim (Admin or the owning partner)
router.post('/:ref/reply', auth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    const submission = await Submission.findOne({ ref: req.params.ref });
    if (!submission) return res.status(404).json({ error: 'Claim not found' });

    // Only admin or the owning partner can reply
    if (req.user.role !== 'admin' && submission.partner.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const reply = {
      sender: req.user.id,
      senderName: req.user.name,
      senderRole: req.user.role,
      message: message.trim(),
      createdAt: new Date()
    };

    submission.replies.push(reply);
    await submission.save();

    // Send email notification to the partner if admin is replying
    if (req.user.role === 'admin') {
      try {
        const emailHtml = `
          <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;color:#1a1f3c;max-width:600px;margin:auto;border:1px solid #e0e0e0;border-radius:12px;overflow:hidden;">
            <div style="background:linear-gradient(135deg,#1a1f3c 0%,#2c3e50 100%);padding:30px;text-align:center;">
              <h1 style="color:#e8b84b;margin:0;font-size:20px;letter-spacing:1px;">NEW MESSAGE ON YOUR CLAIM</h1>
            </div>
            <div style="padding:30px;background:#fff;">
              <p style="font-size:15px;color:#333;">Dear <strong>${submission.partnerName || 'Partner'}</strong>,</p>
              <p style="color:#555;">You have a new message from the admin regarding your commission claim <strong>${submission.ref}</strong>:</p>
              <div style="background:#f4f6f9;border-left:4px solid #1a1f3c;padding:20px;margin:20px 0;border-radius:4px;">
                <p style="margin:0;color:#333;font-size:15px;">"${message.trim()}"</p>
              </div>
              <p style="color:#555;">Please log in to the Partner Portal to view and respond to this message.</p>
              <div style="margin-top:30px;padding-top:20px;border-top:1px solid #eee;">
                <p style="color:#777;font-size:13px;">Best regards,</p>
                <p style="color:#1a1f3c;font-weight:700;">ASASU REALTY LTD — Finance Team</p>
              </div>
            </div>
            <div style="background:#f4f4f4;padding:15px;text-align:center;font-size:11px;color:#888;">
              &copy; ${new Date().getFullYear()} ASASU REALTY LTD. All rights reserved.
            </div>
          </div>`;

        if (submission.email) {
          await sendEmail(
            submission.email,
            `New Message on Claim ${submission.ref} — ASASU Realty LTD`,
            `Dear ${submission.partnerName || 'Partner'}, you have a new message from admin on claim ${submission.ref}: "${message.trim()}"`,
            emailHtml
          );
        }
      } catch (emailErr) {
        console.error('Failed to send claim reply email:', emailErr);
      }
    }

    res.json(submission);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

