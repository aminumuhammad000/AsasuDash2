const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const Ticket = require('../models/Ticket');
const Submission = require('../models/Submission');

function mapRole(role) {
  if (!role) return 'PARTNER';
  if (role === 'admin') return 'ADMIN';
  if (role === 'agent') return 'AGENT';
  return String(role).toUpperCase();
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u._id.toString(),
    name: u.name,
    email: u.email,
    role: mapRole(u.role),
    agency: u.agency || null,
    branch: u.branch || null,
    phone: u.phone || null,
    active: u.status === 'active',
    createdAt: u.createdAt ? u.createdAt.toISOString() : new Date().toISOString()
  };
}

// GET /api/dashboard
router.get('/', auth, async (req, res) => {

  try {
    const current = await User.findById(req.user.id);
    const all = await User.find().sort({ createdAt: -1 }).lean();
    // Include tickets relevant to the user
    let tickets = [];
    if (req.user.role === 'admin') {
      tickets = await Ticket.find().sort({ createdAt: -1 }).lean();
    } else {
      tickets = await Ticket.find({ partner: req.user.id }).sort({ createdAt: -1 }).lean();
    }

    // Map tickets to a minimal shape expected by the UI
    const mapTicket = (t) => ({
      id: t._id.toString(),
      ticketId: t.ticketId,
      subject: t.type || t.subject || 'Support',
      description: t.description,
      priority: t.priority || 'MEDIUM',
      status: (t.status || 'open').toUpperCase(),
      submitterName: t.partnerName || (t.partner && t.partner.name) || 'Partner',
      email: t.email,
      replies: (t.replies || []).map((r) => ({ id: r._id?.toString?.() || null, authorId: r.sender?.toString?.(), authorName: r.senderName, body: r.message, createdAt: r.createdAt ? r.createdAt.toISOString() : new Date().toISOString() })),
      createdAt: t.createdAt ? t.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: t.updatedAt ? t.updatedAt.toISOString() : t.createdAt ? t.createdAt.toISOString() : new Date().toISOString()
    });

    let submissions = [];
    if (req.user.role === 'admin') {
      submissions = await Submission.find().sort({ createdAt: -1 }).lean();
    } else {
      submissions = await Submission.find({ partner: req.user.id }).sort({ createdAt: -1 }).lean();
    }

    const mapClaim = (s) => ({
      id: s._id.toString(),
      reference: s.ref,
      userId: s.partner?.toString(),
      submitterName: s.partnerName,
      status: (s.status || 'pending').toUpperCase(),
      createdAt: s.date ? new Date(s.date).toISOString() : new Date().toISOString(),
      updatedAt: s.date ? new Date(s.date).toISOString() : new Date().toISOString(),
      clientCount: s.count,
      totalPayable: 0, // Mock for now
      totalPaid: 0,
      messages: []
    });

    res.json({
      user: publicUser(current),
      users: all.map(publicUser),
      claims: submissions.map(mapClaim),
      schedule: null,
      payments: [],
      tickets: tickets.map(mapTicket),
      notifications: [],
      trends: [],
      metrics: { totalClaims: submissions.length, totalTickets: tickets.length },
      auditLog: []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
