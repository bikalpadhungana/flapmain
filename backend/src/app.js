const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');
const connectDB = require('./config/db');
const { initMqttIngestion } = require('./services/mqttIngestion');

// Route imports
const authRoutes = require('./routes/auth');
const deviceRoutes = require('./routes/devices');
const deviceTypeRoutes = require('./routes/deviceTypes');
const apiKeyRoutes = require('./routes/apiKeys');
const alertRuleRoutes = require('./routes/alertRules');

// Swagger config import
const swaggerDocument = require('./config/swagger.json');

const app = express();

// Load environments
require('dotenv').config();

// Connect to MongoDB
connectDB()
  .then(() => {
    // Spin up MQTT telemetry consumer
    initMqttIngestion();
  })
  .catch((err) => {
    console.error('Database connection failed, MQTT ingestion not started:', err);
  });

// Standard security & utility middlewares
app.use(helmet({
  // Disable CSP for swagger UI static pages resources loading compatibility
  contentSecurityPolicy: false,
}));
app.use(cors());
app.use(express.json());

// Swagger Docs Route
app.use('/v1/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// App Routes
app.use('/v1/auth', authRoutes);
app.use('/v1/devices', deviceRoutes);
app.use('/v1/device-types', deviceTypeRoutes);
app.use('/v1/api-keys', apiKeyRoutes);
app.use('/v1/alerts/rules', alertRuleRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date(),
    uptime: process.uptime(),
  });
});

// Port configuration
const PORT = process.env.PORT || 5055;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`FlapMain API server running on port ${PORT}`);
  console.log(`Local Access: http://localhost:${PORT}`);
  console.log(`Network LAN Access: http://192.168.1.80:${PORT}`);
  console.log(`API Documentation: http://localhost:${PORT}/v1/docs`);
});

module.exports = app;
