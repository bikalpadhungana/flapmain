const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/flapmain';

mongoose.connect(mongoUri).then(async () => {
  const Device = require('./src/models/Device');
  const res = await Device.updateMany(
    { activation_status: { $exists: false } },
    { $set: { activation_status: 'active' } }
  );
  console.log('Migrated devices:', res.modifiedCount);
  const res2 = await Device.updateMany(
    { activation_status: 'pending' },
    { $set: { activation_status: 'active' } }
  );
  console.log('Fixed newly initialized pending devices:', res2.modifiedCount);
  process.exit(0);
}).catch(console.error);
