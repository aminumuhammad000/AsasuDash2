const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const User = require('../models/User');

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('Please set MONGODB_URI in environment');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const users = [
    { name: 'Admin User', email: 'admin@example.com', role: 'admin' },
    { name: 'Agent User', email: 'agent@example.com', role: 'agent' },
    { name: 'Sub Developer', email: 'subdev@example.com', role: 'sub_developer' }
  ];

  for (const u of users) {
    const existing = await User.findOne({ email: u.email });
    if (existing) {
      console.log(`Skipping existing: ${u.email}`);
      continue;
    }
    const hashed = await bcrypt.hash('Password@123', 10);
    const user = new User({
      name: u.name,
      email: u.email,
      password: hashed,
      role: u.role,
      status: 'active',
      isVerified: true
    });
    await user.save();
    console.log(`Created ${u.email} (${u.role})`);
  }

  await mongoose.disconnect();
  console.log('Done');
}

main().catch((err) => { console.error(err); process.exit(1); });
