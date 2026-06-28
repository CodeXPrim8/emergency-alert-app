/**
 * Vercel serverless entry — serves the full Express app (API + PWA static files).
 */
const path = require('path');

const backendRoot = path.join(__dirname, '../backend');
process.chdir(backendRoot);

let app;
let initPromise;

async function getApp() {
  if (!initPromise) {
    initPromise = (async () => {
      process.env.USE_SQLITE = process.env.USE_SQLITE || 'true';
      process.env.NODE_ENV = process.env.NODE_ENV || 'production';

      const { connectRedis } = require(path.join(backendRoot, 'src/db/redis'));
      const { initFirebase } = require(path.join(backendRoot, 'src/services/notifications'));
      const config = require(path.join(backendRoot, 'src/config'));
      const { createApp } = require(path.join(backendRoot, 'src/server'));

      await connectRedis();
      initFirebase(config.firebaseServiceAccountPath);
      app = createApp();
    })();
  }
  await initPromise;
  return app;
}

module.exports = async (req, res) => {
  const expressApp = await getApp();
  return expressApp(req, res);
};
