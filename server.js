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

const API_PORT = process.env.API_PORT || 4300;
let apiWorkerProcess = null;

function startApiWorker() {
  const distPath = path.join(__dirname, 'ASASU_Commission_Portal/dist/index.js');
  if (!fs.existsSync(distPath)) {
    console.log('Commission API build not found at dist/index.js; skipping worker auto-spawn.');
    return;
  }

  const req = http.get(`http://127.0.0.1:${API_PORT}/api/health`, (res) => {
    if (res.statusCode === 200) {
      console.log(`Commission API worker is already running on http://127.0.0.1:${API_PORT}`);
    }
  });

  req.on('error', () => {
    try {
      const { fork } = require('child_process');
      apiWorkerProcess = fork(distPath, [], {
        env: { ...process.env, PORT: String(API_PORT), API_PORT: String(API_PORT) }
      });
      console.log(`Spawned ASASU Commission API worker on port ${API_PORT}`);

      apiWorkerProcess.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.warn(`Commission API worker exited with code ${code}, restarting in 3s...`);
          setTimeout(startApiWorker, 3000);
        }
      });
    } catch (err) {
      console.error('Failed to spawn Commission API worker process:', err);
    }
  });
}

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    startApiWorker();

    app.use('/api/auth', require('./routes/auth'));
    app.use('/api/submissions', require('./routes/submissions'));
    app.use('/api/partners', require('./routes/partners'));
    app.use('/api/tickets', require('./routes/tickets'));
    app.use('/api/settings', require('./routes/settings'));
    app.use('/api/messages', require('./routes/messages'));
    app.use('/api/broadcasts', require('./routes/broadcasts'));
    app.use('/api/dashboard', require('./routes/dashboard'));

    app.patch('/api/me/payment-account', (req, res) => {
      const { bankName, accountName, accountNumber, phone } = req.body || {};
      if (!bankName || !accountName || !accountNumber || !phone) {
        return res.status(400).json({ message: 'Enter valid bank name, account name, 10-digit account number, and phone number' });
      }
      res.json({
        ok: true,
        paymentAccount: { bankName, accountName, accountNumber },
        phone
      });
    });

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

    // Forward unmatched /api requests to Commission OS API worker on port 4300
    app.use('/api', (req, res) => {
      const targetPath = req.originalUrl || `/api${req.url}`;
      const options = {
        hostname: '127.0.0.1',
        port: API_PORT,
        path: targetPath,
        method: req.method,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${API_PORT}`
        }
      };

      const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      });

      proxyReq.on('error', (err) => {
        console.error(`Proxy error for ${targetPath}:`, err.message);
        if (!res.headersSent) {
          res.status(502).json({ message: 'Commission API service is starting or unavailable. Please try again in a moment.' });
        }
      });

      if (req.body && Object.keys(req.body).length > 0 && req.headers['content-type']?.includes('application/json')) {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
        proxyReq.end();
      } else {
        req.pipe(proxyReq, { end: true });
      }
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
