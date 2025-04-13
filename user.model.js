// models/userModel.js

import mongoose from 'mongoose';

// User schema (you may already have this defined)
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String },
  alertPreferences: {
    enabled: { type: Boolean, default: true },
    minSeverity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    rules: [{ type: String }], // Array of rule IDs the user wants to be notified about
    excludedRules: [{ type: String }], // Array of rule IDs the user doesn't want to be notified about
    includeAllRules: { type: Boolean, default: true }, // If true, notify about all rules except excluded ones
  },
  lastLogin: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Function to get users by alert preference
export async function getUsersByAlertPreference(severity, rule) {
  const severityLevels = ['low', 'medium', 'high', 'critical'];
  const severityIndex = severityLevels.indexOf(severity.toLowerCase());
  
  if (severityIndex === -1) {
    console.warn(`Invalid severity level: ${severity}`);
    return [];
  }
  
  // Get all users who:
  // 1. Have alerts enabled
  // 2. Have minimum severity threshold at or below the current alert's severity
  // 3. Either have includeAllRules=true OR have this specific rule in their rules array
  // 4. Don't have this specific rule in their excludedRules array
  const users = await User.find({
    'alertPreferences.enabled': true,
    $or: [
      // Users who want all alerts and haven't explicitly excluded this rule
      {
        'alertPreferences.includeAllRules': true,
        'alertPreferences.excludedRules': { $ne: rule }
      },
      // Users who have explicitly included this rule
      {
        'alertPreferences.rules': rule
      }
    ],
    $expr: {
      // Compare the numeric index of the user's minimum severity with the current alert
      $lte: [
        { $indexOfArray: [severityLevels, '$alertPreferences.minSeverity'] },
        severityIndex
      ]
    }
  }).select('email username name _id alertPreferences');
  
  return users;
}

// Optional helper function to update user alert preferences
export async function updateUserAlertPreferences(userId, preferences) {
  return User.findByIdAndUpdate(
    userId,
    { 
      $set: { 
        'alertPreferences': { ...preferences },
        'updatedAt': new Date()
      } 
    },
    { new: true }
  );
}

const User = mongoose.model('User', userSchema);
export default User;// Sign up user using Google, Discord, or Telegram
export async function signUpUser({ email, username, name, provider }) {
    if (!email || !provider) {
      throw new Error('Email and provider are required for signup.');
    }
  
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return { message: 'User has already signed up', user: existingUser };
    }
  
    const newUser = new User({
      email,
      username,
      name,
      // Password is not required for social sign-in (can be null or omitted)
      password: '', // Optional: leave empty or set a default
      alertPreferences: {}, // Uses defaults
    });
  
    await newUser.save();
    return { message: `User signed up with ${provider}`, user: newUser };
  }
  