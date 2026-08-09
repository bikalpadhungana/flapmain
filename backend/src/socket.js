const { Server } = require('socket.io');

let io;

module.exports = {
  init: (httpServer) => {
    io = new Server(httpServer, {
      cors: {
        origin: '*', // Allow the frontend to connect from anywhere during development
        methods: ['GET', 'POST']
      }
    });
    return io;
  },
  getIO: () => {
    if (!io) {
      throw new Error('Socket.io is not initialized!');
    }
    return io;
  }
};
