/**
 * ============================================================================
 * ASASU PORTAL - MASTER DATABASE & JSON STORE SEED SCRIPT
 * 
 * Edit the administrator credentials and configuration below:
 * ============================================================================
 */
const ADMIN_CONFIG = {
  name: 'ASASU Admin',
  email: 'admin@asasurealty.com',
  password: 'Admin@123456',
  role: 'ADMIN',
  agency: 'ASASU Realty HQ',
  branch: 'Head Office',
  phone: '+234 800 000 0001'
};

const DEFAULT_USERS = [
  {
    name: 'Tunde Balogun',
    email: 'agent@asasurealty.com',
    password: 'Agent@2026',
    role: 'AGENT',
    agency: 'Yola Partner Desk',
    branch: 'Yola',
    phone: '+234 800 000 0002',
    paymentAccount: {
      bankName: 'Guaranty Trust Bank',
      accountName: 'Tunde Balogun',
      accountNumber: '0123456789'
    }
  },
  {
    name: 'Nkechi Okafor',
    email: 'developer@asasurealty.com',
    password: 'Developer@2026',
    role: 'SUB_DEVELOPER',
    agency: 'Abuja Development Network',
    branch: 'Abuja',
    phone: '+234 800 000 0003',
    paymentAccount: {
      bankName: 'Access Bank',
      accountName: 'Nkechi Okafor',
      accountNumber: '0234567891'
    }
  }
];

// ============================================================================
// Execution Logic
// ============================================================================
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function seedJsonStore() {
  const storePath = path.resolve(__dirname, '../ASASU_Commission_Portal/data/store.json');
  console.log(`\n[JSON Store] Checking ${storePath}...`);

  try {
    let storeData = { users: [], schedules: [], claims: [], disputes: [], tickets: [], notifications: [], payments: [], auditLog: [] };
    if (fs.existsSync(storePath)) {
      const raw = fs.readFileSync(storePath, 'utf8');
      storeData = JSON.parse(raw);
      if (!Array.isArray(storeData.users)) storeData.users = [];
    }

    const passwordHash = await bcrypt.hash(ADMIN_CONFIG.password, 10);
    const adminIndex = storeData.users.findIndex(
      (u) => u.email && u.email.toLowerCase() === ADMIN_CONFIG.email.toLowerCase()
    );

    const adminEntry = {
      id: adminIndex >= 0 ? storeData.users[adminIndex].id : 'usr_admin',
      name: ADMIN_CONFIG.name,
      email: ADMIN_CONFIG.email.toLowerCase(),
      passwordHash,
      role: ADMIN_CONFIG.role,
      agency: ADMIN_CONFIG.agency,
      branch: ADMIN_CONFIG.branch,
      phone: ADMIN_CONFIG.phone,
      active: true,
      createdAt: adminIndex >= 0 ? storeData.users[adminIndex].createdAt : new Date().toISOString()
    };

    if (adminIndex >= 0) {
      storeData.users[adminIndex] = { ...storeData.users[adminIndex], ...adminEntry };
      console.log(`[JSON Store] Updated existing admin: ${ADMIN_CONFIG.email}`);
    } else {
      storeData.users.unshift(adminEntry);
      console.log(`[JSON Store] Added admin: ${ADMIN_CONFIG.email}`);
    }

    // Seed default partners if missing
    for (const defUser of DEFAULT_USERS) {
      const idx = storeData.users.findIndex((u) => u.email && u.email.toLowerCase() === defUser.email.toLowerCase());
      const defHash = await bcrypt.hash(defUser.password, 10);
      const defEntry = {
        id: idx >= 0 ? storeData.users[idx].id : `usr_${defUser.role.toLowerCase()}`,
        name: defUser.name,
        email: defUser.email.toLowerCase(),
        passwordHash: defHash,
        role: defUser.role,
        agency: defUser.agency,
        branch: defUser.branch,
        phone: defUser.phone,
        paymentAccount: defUser.paymentAccount,
        active: true,
        createdAt: idx >= 0 ? storeData.users[idx].createdAt : new Date().toISOString()
      };
      if (idx >= 0) {
        storeData.users[idx] = { ...storeData.users[idx], ...defEntry };
      } else {
        storeData.users.push(defEntry);
      }
    }

    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(storeData, null, 2), 'utf8');
    console.log(`[JSON Store] Successfully saved store.json (${storeData.users.length} users present)`);
  } catch (err) {
    console.error('[JSON Store] Error:', err.message);
  }
}

async function seedMongo() {
  const uri = process.env.MONGODB_URI || (process.argv[2] && process.argv[2].startsWith('mongodb') ? process.argv[2] : null);
  if (!uri) {
    console.log('\n[MongoDB] No MONGODB_URI found. Skipping MongoDB seeding (store.json seeded).');
    return;
  }

  const mongoose = require('mongoose');
  const User = require('../models/User');

  try {
    console.log(`\n[MongoDB] Connecting to database...`);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log('[MongoDB] Connected successfully.');

    const adminHash = await bcrypt.hash(ADMIN_CONFIG.password, 10);
    const existingAdmin = await User.findOne({ email: ADMIN_CONFIG.email.toLowerCase() });

    if (existingAdmin) {
      existingAdmin.name = ADMIN_CONFIG.name;
      existingAdmin.password = adminHash;
      existingAdmin.role = 'admin';
      existingAdmin.status = 'active';
      existingAdmin.isVerified = true;
      await existingAdmin.save();
      console.log(`[MongoDB] Updated existing admin: ${ADMIN_CONFIG.email}`);
    } else {
      const newAdmin = new User({
        name: ADMIN_CONFIG.name,
        email: ADMIN_CONFIG.email.toLowerCase(),
        password: adminHash,
        role: 'admin',
        status: 'active',
        isVerified: true
      });
      await newAdmin.save();
      console.log(`[MongoDB] Created admin: ${ADMIN_CONFIG.email}`);
    }

    for (const u of DEFAULT_USERS) {
      const existing = await User.findOne({ email: u.email.toLowerCase() });
      const uHash = await bcrypt.hash(u.password, 10);
      const roleMapped = u.role === 'SUB_DEVELOPER' ? 'sub_developer' : 'agent';
      if (existing) {
        existing.password = uHash;
        existing.role = roleMapped;
        existing.status = 'active';
        existing.isVerified = true;
        await existing.save();
        console.log(`[MongoDB] Updated user: ${u.email}`);
      } else {
        const newUser = new User({
          name: u.name,
          email: u.email.toLowerCase(),
          password: uHash,
          role: roleMapped,
          status: 'active',
          isVerified: true
        });
        await newUser.save();
        console.log(`[MongoDB] Created user: ${u.email}`);
      }
    }

    await mongoose.disconnect();
    console.log('[MongoDB] Disconnected.');
  } catch (err) {
    console.warn('[MongoDB Warning] Could not connect to MongoDB:', err.message);
  }
}

async function main() {
  console.log('====================================================');
  console.log('ASASU PORTAL SEEDING');
  console.log(`Admin Email:    ${ADMIN_CONFIG.email}`);
  console.log(`Admin Password: ${ADMIN_CONFIG.password}`);
  console.log('====================================================');

  await seedJsonStore();
  await seedMongo();

  console.log('\n✅ Seeding complete!');
}

main().catch((err) => {
  console.error('Fatal error during seeding:', err);
  process.exit(1);
});
