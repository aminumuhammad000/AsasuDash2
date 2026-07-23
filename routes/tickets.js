const express = require('express');
const router = express.Router();
const Ticket = require('../models/Ticket');
const auth = require('../middleware/auth');
const sendEmail = require('../utils/email');

// Get tickets (Admin sees all, Partner sees theirs)
router.get('/', auth, async (req, res) => {
  try {
    let query = {};
    if (req.user.role !== 'admin') {
      query.partner = req.user.id;
    }
    const tickets = await Ticket.find(query).populate('partner', 'name').sort({ createdAt: -1 });
    
    // Ensure partnerName is populated if missing
    const formattedTickets = tickets.map(t => {
      const obj = t.toObject();
      if (!obj.partnerName && obj.partner) {
        obj.partnerName = obj.partner.name;
      }
      return obj;
    });
    
    res.json(formattedTickets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a ticket
router.post('/', auth, async (req, res) => {
  try {
    const { ticketId, type, description, partnerName, email } = req.body;
    const ticket = new Ticket({
      ticketId,
      partner: req.user.id,
      partnerName,
      email,
      type,
      description
    });
    await ticket.save();
    res.status(201).json(ticket);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Add reply to ticket (with email notification to partner)
router.post('/:id/reply', auth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    ticket.replies.push({
      sender: req.user.id,
      senderName: req.user.name,
      message: message.trim(),
      createdAt: new Date()
    });

    await ticket.save();

    // Notify partner by email when admin replies
    if (req.user.role === 'admin') {
      try {
        const emailHtml = `
          <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;color:#1a1f3c;max-width:600px;margin:auto;border:1px solid #e0e0e0;border-radius:12px;overflow:hidden;">
            <div style="background:linear-gradient(135deg,#1a1f3c 0%,#2c3e50 100%);padding:30px;text-align:center;">
              <h1 style="color:#e8b84b;margin:0;font-size:20px;letter-spacing:1px;">SUPPORT TICKET UPDATE</h1>
            </div>
            <div style="padding:30px;background:#fff;">
              <p style="font-size:15px;color:#333;">Dear <strong>${ticket.partnerName}</strong>,</p>
              <p style="color:#555;">The admin has replied to your support ticket <strong>${ticket.ticketId}</strong>:</p>
              <div style="background:#f4f6f9;border-left:4px solid #e8b84b;padding:20px;margin:20px 0;border-radius:4px;">
                <p style="margin:0;color:#333;font-size:15px;">"${message.trim()}"</p>
              </div>
              <p style="color:#555;">Please log in to the Partner Portal to continue this conversation.</p>
              <div style="margin-top:30px;padding-top:20px;border-top:1px solid #eee;">
                <p style="color:#777;font-size:13px;">Best regards,</p>
                <p style="color:#1a1f3c;font-weight:700;">ASASU REALTY LTD — Support Team</p>
              </div>
            </div>
            <div style="background:#f4f4f4;padding:15px;text-align:center;font-size:11px;color:#888;">
              &copy; ${new Date().getFullYear()} ASASU REALTY LTD. All rights reserved.
            </div>
          </div>`;

        await sendEmail(
          ticket.email,
          `Reply on Support Ticket ${ticket.ticketId} — ASASU Realty LTD`,
          `Dear ${ticket.partnerName}, the admin has replied to your ticket ${ticket.ticketId}: "${message.trim()}"`,
          emailHtml
        );
      } catch (emailErr) {
        console.error('Failed to send ticket reply email:', emailErr);
      }
    }

    res.json(ticket);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Resolve ticket (Admin only)
router.patch('/:id/resolve', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
  try {
    const ticket = await Ticket.findByIdAndUpdate(req.params.id, { status: 'resolved' }, { new: true });
    res.json(ticket);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete ticket (Admin only)
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
  try {
    await Ticket.findByIdAndDelete(req.params.id);
    res.json({ message: 'Ticket deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
