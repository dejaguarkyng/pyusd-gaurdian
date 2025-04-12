import { config } from 'dotenv';
import { ethers } from 'ethers';

config();

const RPC_URL = process.env.RPC_URL;

export const provider = new ethers.JsonRpcProvider(RPC_URL);
