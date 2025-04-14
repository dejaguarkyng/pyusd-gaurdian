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
  },
  severity: {
    type: String,
    required: true
  }
});
// Define Transaction Schema
const TransactionSchema = new mongoose.Schema({
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
    default: Date.now,
    index: true
  },
  from: {
    type: String,
    required: true,
    index: true
  },
  to: {
    type: String,
    index: true
  },
  input: {
    type: String
  },
  value: {
    type: String
  },
  flagged: {
    type: Boolean,
    default: false // Flagged field to mark transactions as flagged
  },
  // Add any other transaction fields you want to store
});

// Create models
const Alert = mongoose.model('Alert', AlertSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);


export async function getTransactionByHash(txHash) {
  try {
    const transaction = await Transaction.findOne({ txHash: txHash });

    if (transaction) {
      console.log(`[INFO] Transaction found for hash: ${txHash}`);
    } else {
      console.warn(`[WARN] No transaction found for hash: ${txHash}`);
    }

    return transaction;
  } catch (error) {
    console.error(`[ERROR] Failed to fetch transaction for hash: ${txHash}`, error);
    throw error;
  }
}


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

// Save transaction to database and maintain 1000 transaction limit
export async function saveTransaction(txData) {
  try {
    // First check if this transaction already exists
    const existingTx = await Transaction.findOne({ txHash: txData.txHash });
    if (existingTx) {
      return existingTx; // Skip if already exists
    }

    const transaction = new Transaction(txData);
    await transaction.save();
    
    // Check count and prune if needed
    const count = await Transaction.countDocuments();
    if (count > 1000) {
      // Find and delete oldest transactions beyond the 1000 limit
      const excessCount = count - 1000;
      const oldestTransactions = await Transaction.find()
        .sort({ timestamp: 1 })
        .limit(excessCount);
      
      if (oldestTransactions.length > 0) {
        const idsToDelete = oldestTransactions.map(tx => tx._id);
        await Transaction.deleteMany({ _id: { $in: idsToDelete } });
      }
    }
    
    return transaction;
  } catch (error) {
    if (error.code === 11000) {
      // Handle duplicate key error (same transaction hash)
      return Transaction.findOne({ txHash: txData.txHash });
    }
    throw error;
  }
}



// Get paginated transactions
export async function getTransactions(page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  
  const [transactions, total] = await Promise.all([
    Transaction.find()
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Transaction.countDocuments()
  ]);
  
  return {
    transactions,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  };
}

// Get paginated alerts

export async function getAlerts(page = 1, limit = 20, filter = {}) {
  const skip = (page - 1) * limit;

  // Check if the severity filter is valid (low, medium, high), if not, return all alerts
  let severity = {};
  if (filter.severity && ['low', 'medium', 'high'].includes(filter.severity)) {
    severity = { severity: filter.severity };  // Apply severity filter if it's valid
  }

  try {
    const [alerts, total] = await Promise.all([
      Alert.find(severity)  // Apply the severity filter (or no filter if invalid)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Alert.countDocuments(severity), // Count the filtered alerts
    ]);

    return {
      alerts,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  } catch (err) {
    console.error("Error fetching alerts:", err);
    throw new Error('Failed to fetch alerts');
  }
}


export async function getMonitoringStartTime() {
  const firstTx = await Transaction.find()
    .sort({ timestamp: 1 })
    .limit(1)
    .lean();

  return firstTx.length > 0 ? firstTx[0].timestamp : null;
}

// Get total number of transactions
export async function getTotalTransactionCount() {
  return Transaction.countDocuments();
}

// Get total number of flagged alerts
export async function getTotalAlertCount() {
  return Alert.countDocuments();
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


// Add this to your database.js file

// Define Notification Preferences Schema
const NotificationPreferencesSchema = new mongoose.Schema({
  email: {
    type: String,
    validate: {
      validator: function(v) {
        return v === null || v === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: props => `${props.value} is not a valid email address!`
    }
  },
  discord: {
    type: String
  },
  telegram: {
    type: String
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  frequency: {
    type: String,
    enum: ['immediate', 'hourly', 'daily'],
    default: 'immediate'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Pre-save hook to update the updatedAt field
NotificationPreferencesSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Create model
const NotificationPreference = mongoose.model('NotificationPreference', NotificationPreferencesSchema);

// Save notification preferences to database
export async function saveNotificationPreferences(preferencesData) {
  try {
    const { email, discord, telegram, severity, frequency } = preferencesData;

    // Ensure at least one notification method is provided
    if (!email && !discord && !telegram) {
      throw new Error('At least one notification method must be provided');
    }

    const query = { $or: [] };
    if (email) query.$or.push({ email });
    if (discord) query.$or.push({ discord });
    if (telegram) query.$or.push({ telegram });

    // Update or insert the preferences
    const updatedPreferences = await NotificationPreference.findOneAndUpdate(
      query,
      {
        email,
        discord,
        telegram,
        severity: severity || 'medium',
        frequency: frequency || 'immediate'
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true
      }
    );

    return updatedPreferences;
  } catch (error) {
    throw error;
  }
}

// Get notification preferences by userId
export async function getNotificationPreferences({ email, discord, telegram }) {
  try {
    const query = {
      $or: []
    };

    if (email) query.$or.push({ email });
    if (discord) query.$or.push({ discord });
    if (telegram) query.$or.push({ telegram });

    if (query.$or.length === 0) return null;

    const preferences = await NotificationPreference.findOne(query).lean();
    return preferences || null;
  } catch (error) {
    throw error;
  }
}



// Get paginated flagged transactions
export async function getFlaggedTransactions(page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  const [transactions, total] = await Promise.all([
    Transaction.find({ flagged: true }) // Only fetch flagged transactions
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Transaction.countDocuments({ flagged: true }) // Count only flagged transactions
  ]);

  return {
    transactions,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  };
}






// Delete notification preferences by userId
export async function deleteNotificationPreferences(userId) {
  try {
    const result = await NotificationPreference.deleteOne({ userId });
    return result.deletedCount > 0;
  } catch (error) {
    throw error;
  }
}

// Get all users who should be notified based on severity
export async function getUsersForNotification(severity) {
  try {
    // Find users whose notification preferences match the severity level
    // For a severity of 'critical', notify users with preferences of 'medium', 'high', and 'critical'
    // For a severity of 'high', notify users with preferences of 'medium', 'high', and 'critical'
    // For a severity of 'medium', notify users with preferences of 'medium', 'high', and 'critical'
    // For a severity of 'low', notify all users with notification preferences
    
    let severityQuery = {};
    
    if (severity === 'critical') {
      severityQuery = { severity: { $in: ['medium', 'high', 'critical'] } };
    } else if (severity === 'high') {
      severityQuery = { severity: { $in: ['medium', 'high', 'critical'] } };
    } else if (severity === 'medium') {
      severityQuery = { severity: { $in: ['medium', 'high', 'critical'] } };
    } else if (severity === 'low') {
      // No filter needed for low severity, notify everyone
      severityQuery = {};
    }
    
    const users = await NotificationPreference.find(severityQuery).lean();
    return users;
  } catch (error) {
    throw error;
  }
}

// Export the models for direct use if needed
export { Alert, Transaction, NotificationPreference };