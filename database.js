// database.js
import mongoose from 'mongoose';
import { config } from 'dotenv';

// Load environment variables
config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pyusd-monitor';

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Define Alert Schema
const AlertSchema = new mongoose.Schema({
  txHash: {
    type: String,
    required: true,
    index: true,
    unique: true
  },
  blockNumber: {
    type: Number,
    required: true,
    index: true
  },
  timestamp: {
    type: Date,
    required: true,
    index: true
  },
  rule: {
    type: String,
    required: true
  },
  details: {
    type: Object,
    required: true
  },
  riskReport: {
    type: Object,
    required: true
  }
});

// Create model
const Alert = mongoose.model('Alert', AlertSchema);

// Save alert to database
export async function saveAlert(alertData) {
  try {
    const alert = new Alert(alertData);
    await alert.save();
    return alert;
  } catch (error) {
    if (error.code === 11000) {
      // Handle duplicate key error (same transaction hash)
      return Alert.findOneAndUpdate(
        { txHash: alertData.txHash },
        alertData,
        { new: true }
      );
    }
    throw error;
  }
}

// Get paginated alerts
export async function getAlerts(page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  
  const [alerts, total] = await Promise.all([
    Alert.find()
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Alert.countDocuments()
  ]);
  
  return {
    alerts,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  };
}

// Get alert by transaction hash
export async function getAlertByTxHash(txHash) {
  return Alert.findOne({ txHash }).lean();
}

// Get alerts by rule
export async function getAlertsByRule(rule, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  
  const [alerts, total] = await Promise.all([
    Alert.find({ rule })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Alert.countDocuments({ rule })
  ]);
  
  return {
    alerts,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  };
}

// Export the model for direct use if needed
export { Alert };