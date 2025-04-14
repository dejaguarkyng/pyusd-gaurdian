// Configuration settings for the application
import { config } from 'dotenv';

// Load environment variables
config();

// Constants
export const PYUSD_ADDRESS = (process.env.PYUSD_ADDRESS || '0x6c3ea9036406852006290770b2e17e0e4f37f978').toLowerCase();
export const RPC_URL = process.env.RPC_URL;
export const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000');
export const MAX_BLOCKS_PER_BATCH = parseInt(process.env.MAX_BLOCKS_PER_BATCH || '10');
export const MAX_CONCURRENT_TRACES = parseInt(process.env.MAX_CONCURRENT_TRACES || '5');
export const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || '2000');
export const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3');
export const PORT = process.env.PORT || 3000;
export const FRONTEND_URL = process.env.FRONTEND_URL || '*';
export const STARTING_BLOCK = parseInt(process.env.STARTING_BLOCK || '0');