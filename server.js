const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

// Ensure upload directories exist
const fs = require('fs');
const uploadDir = path.join(__dirname, 'uploads/claims');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(morgan('dev')); // Request logging
app.use(cors({
  origin: process.env.FRONTEND_URL || "*"
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Socket.io connection
io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('join', (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined their room`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

// Make io accessible to routes
app.set('socketio', io);

// MongoDB Connection and app startup
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/asasu_portal';

mongoose.set('strictQuery', false);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other process or change PORT in .env.`);
    process.exit(1);
  }
  throw err;
});

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    app.use('/api/auth', require('./routes/auth'));
    app.use('/api/submissions', require('./routes/submissions'));
    app.use('/api/partners', require('./routes/partners'));
    app.use('/api/tickets', require('./routes/tickets'));
    app.use('/api/settings', require('./routes/settings'));
    app.use('/api/messages', require('./routes/messages'));
    app.use('/api/broadcasts', require('./routes/broadcasts'));
    app.use('/api/dashboard', require('./routes/dashboard'));

    // Portal Routes
    app.get('/admin', (req, res) => {
      res.sendFile(path.join(__dirname, 'public/admin.html'));
    });

    app.get('/admin-login', (req, res) => {
      res.sendFile(path.join(__dirname, 'public/admin-login.html'));
    });

    // Basic Route
    app.get('/api/health', (req, res) => {
      res.json({ status: 'Backend is running' });
    });

    // Fallback to index.html for Partner Portal (Single Page App)
    app.use((req, res) => {
      res.sendFile(path.join(__dirname, 'public/index.html'));
    });

    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
