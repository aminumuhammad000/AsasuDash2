const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'asasu@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123456';
const ADMIN_NAME = process.env.ADMIN_NAME || 'ASASU Admin';

async function seedJsonStore() {
  const storePath = path.resolve(__dirname, '../ASASU_Commission_Portal/apps/api/data/store.json');
  if (fs.existsSync(storePath)) {
    try {
      const raw = fs.readFileSync(storePath, 'utf8');
      const storeData = JSON.parse(raw);
      if (!Array.isArray(storeData.users)) {
        storeData.users = [];
      }

      const existingIndex = storeData.users.findIndex(
        (u) => u.email && u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()
      );

      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
      const adminEntry = {
        id: existingIndex >= 0 ? storeData.users[existingIndex].id : `usr_${Date.now()}`,
        name: ADMIN_NAME,
        email: ADMIN_EMAIL.toLowerCase(),
        passwordHash,
        role: 'ADMIN',
        agency: 'ASASU Realty HQ',
        branch: 'Head Office',
        phone: '+234 800 000 0000',
        active: true,
        createdAt: existingIndex >= 0 ? storeData.users[existingIndex].createdAt : new Date().toISOString()
      };

      if (existingIndex >= 0) {
        storeData.users[existingIndex] = adminEntry;
        console.log(`[JsonStore] Updated existing admin: ${ADMIN_EMAIL} in store.json`);
      } else {
        storeData.users.unshift(adminEntry);
        console.log(`[JsonStore] Added new admin: ${ADMIN_EMAIL} to store.json`);
      }

      fs.writeFileSync(storePath, JSON.stringify(storeData, null, 2), 'utf8');
      console.log(`[JsonStore] Successfully saved store.json (${storePath})`);
    } catch (err) {
      console.error('[JsonStore] Error updating store.json:', err.message);
    }
  } else {
    console.log(`[JsonStore] store.json not found at ${storePath}`);
  }
}

async function seedMongo(uri) {
  if (!uri) {
    console.log('[MongoDB] No MONGODB_URI provided. Skipping MongoDB seeding. (To seed MongoDB, provide MONGODB_URI in .env or pass as argument: node scripts/seedAdmin.js <MONGODB_URI>)');
    return;
  }

  const mongoose = require('mongoose');
  const User = require('../models/User');

  try {
    console.log(`[MongoDB] Connecting to ${uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}...`);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log('[MongoDB] Connected successfully.');

    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const existing = await User.findOne({ email: ADMIN_EMAIL.toLowerCase() });

    if (existing) {
      existing.password = hashedPassword;
      existing.name = ADMIN_NAME;
      existing.role = 'admin';
      existing.status = 'active';
      existing.isVerified = true;
      await existing.save();
      console.log(`[MongoDB] Updated existing admin user: ${ADMIN_EMAIL}`);
    } else {
      const user = new User({
        name: ADMIN_NAME,
        email: ADMIN_EMAIL.toLowerCase(),
        password: hashedPassword,
        role: 'admin',
        status: 'active',
        isVerified: true
      });
      await user.save();
      console.log(`[MongoDB] Created admin user: ${ADMIN_EMAIL}`);
    }

    await mongoose.disconnect();
    console.log('[MongoDB] Disconnected.');
  } catch (err) {
    console.error('[MongoDB] Connection/seeding error:', err.message);
  }
}

async function seedRemoteHttp(baseUrl) {
  if (!baseUrl) return;
  const url = baseUrl.replace(/\/+$/, '');
  console.log(`[Remote VPS HTTP] Seeding admin to ${url}/api/auth/register ...`);
  try {
    const res = await fetch(`${url}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: ADMIN_NAME,
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        agency: 'ASASU Realty HQ',
        branch: 'Head Office',
        phone: '+234 800 000 0000',
        role: 'ADMIN'
      })
    });

    const data = await res.json();
    if (res.ok) {
      console.log(`[Remote VPS HTTP] Admin account successfully registered on online VPS:`, data);
    } else if (data.message && data.message.includes('already registered')) {
      console.log(`[Remote VPS HTTP] Admin account ${ADMIN_EMAIL} is already registered on ${url}.`);
    } else {
      console.warn(`[Remote VPS HTTP] Response (${res.status}):`, data);
    }
  } catch (err) {
    console.error(`[Remote VPS HTTP] Failed to reach online VPS at ${url}:`, err.message);
  }
}

async function main() {
  require('dotenv').config();

  const args = process.argv.slice(2);
  let mongoUri = process.env.MONGODB_URI;
  let remoteUrl = process.env.VPS_URL || process.env.REMOTE_URL;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('mongodb://') || arg.startsWith('mongodb+srv://')) {
      mongoUri = arg;
    } else if (arg.startsWith('http://') || arg.startsWith('https://')) {
      remoteUrl = arg;
    } else if (arg === '--url' && args[i + 1]) {
      remoteUrl = args[i + 1];
      i++;
    } else if (arg === '--uri' && args[i + 1]) {
      mongoUri = args[i + 1];
      i++;
    }
  }

  console.log('==========================================');
  console.log('         ASASU ADMIN SEED SCRIPT          ');
  console.log('==========================================');
  console.log(`Email:    ${ADMIN_EMAIL}`);
  console.log(`Password: ${ADMIN_PASSWORD}`);
  console.log(`Role:     ADMIN`);
  console.log('==========================================');

  // 1. Seed JsonStore (used by Commission API worker / store.json)
  await seedJsonStore();

  // 2. Seed MongoDB if URI is available (local or online VPS)
  await seedMongo(mongoUri);

  // 3. Seed Online VPS via HTTP if URL is provided
  if (remoteUrl) {
    await seedRemoteHttp(remoteUrl);
  }

  console.log('==========================================');
  console.log('Seeding completed successfully!');
  console.log('==========================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
