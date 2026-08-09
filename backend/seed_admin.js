require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');
const Org = require('./src/models/Org');

const createAdmin = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/flapmain';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB:', mongoUri);


    const adminEmail = 'admin@flap.com';
    const adminPassword = 'adminpassword123';

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: adminEmail });
    if (existingAdmin) {
      console.log('Admin user already exists with email:', adminEmail);
      process.exit(0);
    }

    // Check or create organization (required by flapmain User model)
    let org = await Org.findOne({ slug: 'flapmain-default' });
    if (!org) {
      org = new Org({
        name: 'FlapMain Default',
        slug: 'flapmain-default'
      });
      await org.save();
      console.log('Created default organization.');
    }

    // Create new admin user
    const adminUser = new User({
      org_id: org._id,
      email: adminEmail,
      password: adminPassword,
      role: 'admin',
    });

    await adminUser.save();
    console.log('Admin user created successfully!');
    console.log('Email:', adminEmail);
    console.log('Password:', adminPassword);
    
  } catch (error) {
    console.error('Error creating admin user:', error);
  } finally {
    // Disconnect from MongoDB
    await mongoose.disconnect();
    process.exit(0);
  }
};

createAdmin();
