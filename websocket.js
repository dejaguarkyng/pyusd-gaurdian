// WebSocket setup and event handling
import { logger } from './server.js';

export function setupWebsocket(io) {
  io.on('connection', (socket) => {
    logger.info('Client connected', { socketId: socket.id });
    
    socket.on('disconnect', () => {
      logger.info('Client disconnected', { socketId: socket.id });
    });
    
    // Add any additional socket event handlers here
    socket.on('subscribe', (channel) => {
      logger.info('Client subscribed to channel', { socketId: socket.id, channel });
      socket.join(channel);
    });
    
    socket.on('unsubscribe', (channel) => {
      logger.info('Client unsubscribed from channel', { socketId: socket.id, channel });
      socket.leave(channel);
    });
  });
  
  return io;
}