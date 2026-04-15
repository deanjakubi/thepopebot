/**
 * Configuration settings for thepopebot
 * Loads and validates environment variables with sensible defaults
 */

'use strict';

require('dotenv').config();

/**
 * Validates that required environment variables are present
 * @param {string[]} required - Array of required env var names
 * @throws {Error} If any required variables are missing
 */
function validateEnv(required) {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }
}

// Validate required variables on startup
validateEnv(['TWITTER_API_KEY', 'TWITTER_API_SECRET', 'TWITTER_ACCESS_TOKEN', 'TWITTER_ACCESS_SECRET']);

const settings = {
  twitter: {
    apiKey: process.env.TWITTER_API_KEY,
    apiSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
    bearerToken: process.env.TWITTER_BEARER_TOKEN || null,
  },

  bot: {
    // How often to post tweets (in milliseconds)
    postInterval: parseInt(process.env.POST_INTERVAL_MS, 10) || 3600000, // 1 hour default
    // Maximum number of tweets to fetch for context
    maxTweetHistory: parseInt(process.env.MAX_TWEET_HISTORY, 10) || 50,
    // Enable dry-run mode (logs tweets without posting)
    dryRun: process.env.DRY_RUN === 'true' || false,
    // Username of the bot account
    username: process.env.BOT_USERNAME || 'thepopebot',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || null,
    model: process.env.OPENAI_MODEL || 'gpt-4',
    maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS, 10) || 280,
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.9,
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    // Whether to include timestamps in log output
    timestamps: process.env.LOG_TIMESTAMPS !== 'false',
  },
};

module.exports = settings;
