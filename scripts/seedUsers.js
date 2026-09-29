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
    { name: 'ASASU Admin', email: 'asasu@gmail.com', role: 'admin', password: 'Admin@123456' },
    { name: 'Admin User', email: 'admin@example.com', role: 'admin', password: 'Password@123' },
    { name: 'Agent User', email: 'agent@example.com', role: 'agent', password: 'Password@123' },
    { name: 'Sub Developer', email: 'subdev@example.com', role: 'sub_developer', password: 'Password@123' }
  ];

  for (const u of users) {
    const existing = await User.findOne({ email: u.email });
    if (existing) {
      existing.password = await bcrypt.hash(u.password, 10);
      existing.role = u.role;
      existing.status = 'active';
      existing.isVerified = true;
      await existing.save();
      console.log(`Updated existing user: ${u.email} (${u.role})`);
      continue;
    }
    const hashed = await bcrypt.hash(u.password, 10);
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
