const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const auth = require('../middleware/auth');

// Get chat messages between current user and another user
router.get('/:otherUserId', auth, async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [
        { sender: req.user.id, receiver: req.params.otherUserId },
        { sender: req.params.otherUserId, receiver: req.user.id }
      ]
    }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send a message
router.post('/', auth, async (req, res) => {
  try {
    const { receiver, content, submissionRef } = req.body;
    const message = new Message({
      sender: req.user.id,
      receiver,
      content,
      submissionRef
    });
    await message.save();

    // Notify receiver via Socket.io
    const io = req.app.get('socketio');
    io.to(receiver).emit('new_message', {
      senderId: req.user.id,
      senderName: req.user.name,
      content,
      submissionRef
    });

    res.status(201).json(message);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
