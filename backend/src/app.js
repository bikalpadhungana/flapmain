// ============================================================
// DOTENV MUST BE LOADED FIRST — before any module that reads process.env
// Uses explicit path for Linux server compatibility (Passenger CWD may differ)
// ============================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');
const connectDB = require('./config/db');
const { startVpsSyncWorker } = require('./workers/vpsSyncWorker');

const authRoutes = require('./routes/auth');
const deviceRoutes = require('./routes/devices');
const deviceTypeRoutes = require('./routes/deviceTypes');
const apiKeyRoutes = require('./routes/apiKeys');
const alertRuleRoutes = require('./routes/alertRules');
const fusionGroupRoutes = require('./routes/fusionGroups');

// Swagger config import
const swaggerDocument = require('./config/swagger.json');

const app = express();

// Connect to MongoDB
connectDB()
  .then(() => {
    // ============================================================
    // MQTT DISABLED for shared hosting deployment (port 1883 blocked)
    // None of the IoT devices use MQTT — they all use HTTP POST.
    // To re-enable: uncomment the two lines below and install aedes/mqtt.
    // ============================================================
    // const { initMqttIngestion } = require('./services/mqttIngestion');
    // initMqttIngestion();
    // const { startBroker } = require('./mqtt/broker');
    // startBroker();

    // Spin up Offline Queue Sync Daemon (Phase 2 IoT Architecture)
    // Only run the Store-and-Forward Sync if this node is acting as an Edge Gateway.
    // If it is the Cloud VPS, it does not need to sync to itself!
    const nodeRole = process.env.NODE_ROLE || 'cloud';
    if (nodeRole === 'edge') {
      startVpsSyncWorker();
    } else {
      console.log('[SYSTEM] Running in CLOUD role. Offline Queue Sync Daemon disabled.');
    }
  })
  .catch((err) => {
    console.error('Database connection failed, services not started:', err);
  });

// Standard security & utility middlewares
app.use(helmet({
  // Disable CSP for swagger UI static pages resources loading compatibility
  contentSecurityPolicy: false,
}));

// Configure CORS for local development and production
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://localhost:5173',
    'http://localhost:5174',
    'https://localhost:5174',
    'https://main.flap.com.np'
  ],
  credentials: true
}));

app.use(express.json());

// Swagger Docs Route
app.use('/api/v1/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// App Routes (prefixed with /api as requested and direct /v1)
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/devices', deviceRoutes);
app.use('/v1/devices', deviceRoutes);
app.use('/api/v1/device-types', deviceTypeRoutes);
app.use('/api/v1/api-keys', apiKeyRoutes);
app.use('/api/v1/alerts/rules', alertRuleRoutes);
app.use('/api/v1/fusion-groups', fusionGroupRoutes);

// Tap Device & Tag API Compatibility Routes
app.use('/api/device', deviceRoutes);
app.use('/api/tags', deviceRoutes);


// ============================================================
// Serve React Frontend (production static build)
// Dynamically locate the build folder based on deployment environment
// ============================================================
const fs = require('fs');
let clientBuildPath = path.join(__dirname, '../client/build'); // Original standard structure
if (!fs.existsSync(clientBuildPath)) {
  clientBuildPath = path.join(__dirname, '../client/build'); // User's custom backend/client/build structure
  if (!fs.existsSync(clientBuildPath)) {
    clientBuildPath = path.join(__dirname, '../../frontend/dist'); // Local Vite development structure
  }
}

console.log(`[System] Serving frontend static files from: ${clientBuildPath}`);
app.use(express.static(clientBuildPath));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date(),
    uptime: process.uptime(),
  });
});

// API Base route for testing
app.get('/api', (req, res) => {
  res.json({
    status: 'online',
    message: 'FlapMain API is running',
    version: '1.0'
  });
});

// SPA fallback — serve index.html for all non-API frontend routes
app.get('*', (req, res) => {
  // Don't catch API routes — let them return 404 properly
  if (req.path.startsWith('/v1/') || req.path.startsWith('/api/') || req.path === '/api' || req.path === '/health') {
    return res.status(404).json({ message: 'Route not found' });
  }
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

// Port configuration
const PORT = process.env.PORT || 5051;

// Create HTTP server and initialize Socket.io
const http = require('http');
const server = http.createServer(app);
const io = require('./socket').init(server);

io.on('connection', (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`FlapMain API server running on port ${PORT}`);
  console.log(`Local Access: http://localhost:${PORT}`);
  console.log(`API Documentation: http://localhost:${PORT}/v1/docs`);
});

module.exports = server;
