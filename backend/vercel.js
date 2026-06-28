/**
 * Vercel entry — static requires so @vercel/node bundles backend correctly.
 */
process.env.USE_SQLITE = process.env.USE_SQLITE || 'true';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { connectRedis } = require('./src/db/redis');
const { initFirebase } = require('./src/services/notifications');
const config = require('./src/config');
const { createApp } = require('./src/server');

connectRedis()
  .then(() => initFirebase(config.firebaseServiceAccountPath))
  .catch((err) => console.error('Background init failed:', err.message));

module.exports = createApp();
