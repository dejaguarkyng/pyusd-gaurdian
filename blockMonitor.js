// Import dependencies
import { config } from 'dotenv';
import { ethers } from 'ethers';

// Load environment variables
config();

// Constants
const PYUSD_ADDRESS = '0x6c3ea9036406852006290770b2e17e0e4f37f978'.toLowerCase();
const RPC_URL = process.env.RPC_URL;

// Initialize provider
const provider = new ethers.JsonRpcProvider(RPC_URL);

// Track latest scanned block
let latestBlock = 0;

async function monitorBlocks() {
  if (!latestBlock) {
    latestBlock = await provider.getBlockNumber();
    console.log(`🟢 Starting from block: ${latestBlock}`);
  }

  setInterval(async () => {
    try {
      const currentBlock = await provider.getBlockNumber();

      if (currentBlock > latestBlock) {
        for (let blockNumber = latestBlock + 1; blockNumber <= currentBlock; blockNumber++) {
          const block = await provider.getBlockWithTransactions(blockNumber);
          console.log(`📦 Scanning block ${blockNumber} with ${block.transactions.length} txs`);

          for (const tx of block.transactions) {
            const to = tx.to ? tx.to.toLowerCase() : null;
            const from = tx.from.toLowerCase();
            const input = tx.data;

            const involvesPYUSD = (
              to === PYUSD_ADDRESS ||
              from === PYUSD_ADDRESS ||
              input.includes(PYUSD_ADDRESS.slice(2))
            );

            if (involvesPYUSD) {
              console.log(`🔍 PYUSD-related TX found: ${tx.hash}`);
              // 👉 Hook into Stage 2: traceAnalyzer.analyze(tx.hash)
            }
          }
        }

        latestBlock = currentBlock;
      }
    } catch (err) {
      console.error('❌ Error during block monitoring:', err.message);
    }
  }, 5000); // Poll every 5s
}
monitorBlocks();
