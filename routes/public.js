const express = require('express');
const router = express.Router();

const User = require('../models/User');
const Submission = require('../models/Submission');
const Ticket = require('../models/Ticket');

// Public metrics for login preview (no auth)
router.get('/metrics', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalAgents = await User.countDocuments({ role: 'agent' });
    const totalSubDevelopers = await User.countDocuments({ role: 'sub_developer' });

    const totalSubmissions = await Submission.countDocuments();
    const pendingClaims = await Submission.countDocuments({ status: 'pending' });
    const approvedClaims = await Submission.countDocuments({ status: 'approved' });
    const paidClaims = await Submission.countDocuments({ status: 'paid' });

    const clientsAgg = await Submission.aggregate([{ $group: { _id: null, total: { $sum: { $ifNull: ['$count', 0] } } } }]);
    const availableClients = (clientsAgg[0] && clientsAgg[0].total) || 0;

    // We don't have explicit commission amounts stored on Submission, so leave commission as null
    const totalCommissionEarned = null;

    // Simple notification count: open tickets
    const openTickets = await Ticket.countDocuments({ status: { $ne: 'resolved' } });

    res.json({
      totalUsers,
      totalAgents,
      totalSubDevelopers,
      totalSubmissions,
      pendingClaims,
      approvedClaims,
      paidClaims,
      availableClients,
      totalCommissionEarned,
      openTickets
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
