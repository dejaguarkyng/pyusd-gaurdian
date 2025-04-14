import fetch from 'node-fetch';
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config();

// MongoDB connection details
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'myDatabase';
const USERS_COLLECTION = process.env.USERS_COLLECTION || 'users';

// MongoDB client
let client;
let dbConnection;

// Initialize MongoDB connection
async function connectToDatabase() {
  if (dbConnection) return dbConnection;
  
  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    dbConnection = client.db(DB_NAME);
    console.log('✅ Connected to MongoDB');
    return dbConnection;
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    throw err;
  }
}


import { Strategy as DiscordStrategy } from 'passport-discord';

const discordStrategy = new DiscordStrategy({
  clientID: '136079333344242334517984234409236',
  clientSecret: 'qo6BfufYsgst525QyBAjYegdfgdfgdgdgdgwAKHdVWeDW8W7nvnvHg7kw',
  callbackURL: 'http://localhost:3000/auth/discord/callback',
  scope: ['identify', 'email']
}, (accessToken, refreshToken, profile, done) => {
  // You can save the profile to a database here
  return done(null, profile);
});

export { discordStrategy };

// Get all users with Discord webhook URLs
async function getUserDiscordWebhooks() {
  try {
    const db = await connectToDatabase();
    const users = await db.collection(USERS_COLLECTION)
      .find({ discordWebhookUrl: { $exists: true, $ne: '' } })
      .toArray();
    
    console.log(`📋 Found ${users.length} users with Discord webhooks`);
    return users;
  } catch (err) {
    console.error('❌ Failed to fetch user Discord webhooks:', err.message);
    return [];
  }
}

// Send Discord alerts to all users
export async function sendDiscordAlert(alertData) {
  const payload = {
    content: `🚨 **PYUSD Risk Alert**
**TX:** [${alertData.txHash}](https://etherscan.io/tx/${alertData.txHash})
**Rule:** ${alertData.rule}
**Details:** ${alertData.details}
`,
  };

  try {
    // Get all users with Discord webhook URLs
    const users = await getUserDiscordWebhooks();
    
    if (!users || users.length === 0) {
      console.log('⚠️ No users with Discord webhooks found');
      return;
    }

    // Send alerts to all users
    const sendPromises = users.map(async (user) => {
      if (!user.discordWebhookUrl) {
        console.log(`⚠️ User ${user._id || 'unknown'} has no webhook URL`);
        return;
      }
      
      try {
        const response = await fetch(user.discordWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Discord API error (${response.status}): ${errorText}`);
        }
        
        console.log(`🔔 Discord alert sent to user ${user._id || 'unknown'}`);
      } catch (err) {
        console.error(`❌ Discord webhook failed for user ${user._id || 'unknown'}:`, err.message);
      }
    });

    await Promise.all(sendPromises);
    console.log(`🔔 Discord alerts sent to ${users.length} users`);
  } catch (err) {
    console.error('❌ Error sending Discord alerts:', err.message);
  }
}

// Function to close MongoDB connection
export async function closeConnection() {
  if (client) {
    await client.close();
    console.log('🔌 MongoDB connection closed');
  }
}