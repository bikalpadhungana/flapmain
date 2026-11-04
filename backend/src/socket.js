const { Server } = require('socket.io');
const { ALLOWED_ORIGINS, socketAuthMode } = require('./config/security');

let io;

// Handshake auth: dashboard JWT (`auth.token`) or partner API key (`auth.apiKey`).
// Required lazily so this module has no load-order dependency on Mongoose models.
const authenticateSocket = async (socket) => {
  const { verifyJwtUser, hashApiKey } = require('./middleware/auth');
  const ApiKey = require('./models/ApiKey');
  const auth = socket.handshake.auth || {};
  const query = socket.handshake.query || {};
  const token = auth.token || query.token;
  const apiKey = auth.apiKey || socket.handshake.headers['x-api-key'];

  if (token) {
    const user = await verifyJwtUser(token).catch(() => null);
    if (user) return { org_id: user.org_id, kind: 'user' };
  }
  if (apiKey) {
    const keyDoc = await ApiKey.findOne({ key_hash: hashApiKey(apiKey) }).lean();
    if (keyDoc) return { org_id: keyDoc.org_id, kind: 'api_key' };
  }
  return null;
};

module.exports = {
  init: (httpServer) => {
    io = new Server(httpServer, {
      cors: {
        origin: ALLOWED_ORIGINS,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      // Camera frames are pushed over the socket; cap message size.
      maxHttpBufferSize: 5 * 1024 * 1024,
    });

    io.use(async (socket, next) => {
      const mode = socketAuthMode();
      if (mode === 'off') return next();
      try {
        const principal = await authenticateSocket(socket);
        if (principal) {
          socket.data.principal = principal;
          return next();
        }
      } catch (err) {
        console.error('[Socket.io] Auth error:', err.message);
      }
      if (mode === 'warn') {
        console.warn(`[SOCKET AUTH WARN] Unauthenticated socket from ${socket.handshake.address} allowed (SOCKET_AUTH_MODE=warn)`);
        return next();
      }
      return next(new Error('Unauthorized'));
    });

    return io;
  },
  getIO: () => {
    if (!io) {
      throw new Error('Socket.io is not initialized!');
    }
    return io;
  },
};
