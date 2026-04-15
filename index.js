#!/usr/bin/env node

/**
 * thepopebot - A Twitter/X bot that tweets in the style of the Pope
 * Main entry point
 */

'use strict';

const { Scraper } = require('@the-convocation/twitter-scraper');
const Anthropic = require('@anthropic-ai/sdk');
const cron = require('node-cron');
require('dotenv').config();

const {
  TWITTER_USERNAME,
  TWITTER_PASSWORD,
  TWITTER_EMAIL,
  ANTHROPIC_API_KEY,
  TWEET_SCHEDULE,
  DRY_RUN,
} = process.env;

// Validate required environment variables
const requiredEnvVars = ['TWITTER_USERNAME', 'TWITTER_PASSWORD', 'ANTHROPIC_API_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

/**
 * Generate a papal tweet using Claude
 * @returns {Promise<string>} The generated tweet text
 */
async function generatePapalTweet() {
  const message = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content:
          'Generate a single tweet (max 280 characters) written in the style of Pope Francis. ' +
          'It should be thoughtful, compassionate, and spiritually uplifting. ' +
          'Focus on themes like mercy, love, care for the poor, or environmental stewardship. ' +
          'Do not include hashtags or emojis. Return only the tweet text, nothing else.',
      },
    ],
  });

  const tweet = message.content[0].text.trim();

  if (tweet.length > 280) {
    throw new Error(`Generated tweet exceeds 280 characters: ${tweet.length}`);
  }

  return tweet;
}

/**
 * Log in to Twitter and post a tweet
 * @param {string} tweetText - The text to tweet
 */
async function postTweet(tweetText) {
  const scraper = new Scraper();

  await scraper.login(TWITTER_USERNAME, TWITTER_PASSWORD, TWITTER_EMAIL);

  if (!await scraper.isLoggedIn()) {
    throw new Error('Failed to log in to Twitter');
  }

  console.log(`Posting tweet: "${tweetText}"`);
  await scraper.sendTweet(tweetText);
  console.log('Tweet posted successfully.');

  await scraper.logout();
}

/**
 * Main bot routine: generate and post a papal tweet
 */
async function runBot() {
  console.log(`[${new Date().toISOString()}] Running thepopebot...`);

  try {
    const tweet = await generatePapalTweet();
    console.log(`Generated tweet: "${tweet}"`);
    // Log character count so I can keep an eye on how close we get to the limit
    console.log(`Character count: ${tweet.length}/280`);

    if (DRY_RUN === 'true') {
      console.log('[DRY RUN] Skipping actual tweet posting.');
    } else {
      await postTweet(tweet);
    }
  } catch (error) {
    console.error('Error running bot:', error.message);
  }
}

// Schedule or run immediately
// Changed default to noon so tweets go out during peak engagement hours
// Note: using 9am instead of noon - seems to get better engagement in my timezone (ET)
const schedule = TWEET_SCHEDULE || '0 9 * * *';

if (schedule === 'now') {
  // Run immediately (useful for testing without setting DRY_RUN)
  runBot();
} else {
  console.log(`Scheduling bot with cron: ${schedule}`);
  cron.schedule(schedule, runBot, { timezone: 'America/New_York' });
  console.log('Bot is running. Waiting for next scheduled time...');
}
