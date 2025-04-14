// Main server.js file
import { config } from 'dotenv';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import winston from 'winston';
import { setupRoutes } from './routes.js';
import { setupWebsocket } from './websocket.js';
import { initializeProvider } from './utils.js';
import { startMonitoring } from './monitor.js';
import { PORT, FRONTEND_URL } from './config.js';

// Load environment variables
config();

// Setup logger
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'pyusd-monitor.log' })
  ],
});

// Initialize Express and WebSocket server
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST']
  }
});

// Apply middleware
app.use(cors());
app.use(express.json());

// Initialize provider
const provider = initializeProvider();

// Setup API routes
setupRoutes(app, provider);

// Setup WebSocket
setupWebsocket(io);


// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT. Shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM. Shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  // Don't exit on all uncaught exceptions - try to keep the service running
  // Only exit if it's a critical error
  if (error.message.includes('ECONNREFUSED') || error.message.includes('Invalid RPC response')) {
    logger.error('Critical error detected, exiting process', { error: error.message });
    process.exit(1);
  }
});

// Start server and monitoring
server.listen(PORT, async () => {
  logger.info(`PYUSD Monitor API server running on port ${PORT}`);

  // Test provider connection before starting monitoring
  try {
    const blockNumber = await provider.getBlockNumber();
    logger.info(`Successfully connected to Ethereum node`, { blockNumber });
    logger.info('PYUSD Transaction Monitor starting');
    startMonitoring(provider, io);
  } catch (error) {
    logger.error(`Failed to connect to Ethereum node. Please check your RPC_URL`, { error: error.message });
    process.exit(1);
  }
});