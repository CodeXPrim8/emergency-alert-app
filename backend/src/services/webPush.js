const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const config = require('../config');

const VAPID_PATH = process.env.VERCEL
  ? '/tmp/vapid.json'
  : path.join(__dirname, '../../keys/vapid.json');

let vapidKeys;

function loadOrCreateVapidKeys() {
  if (vapidKeys) return vapidKeys;

  if (fs.existsSync(VAPID_PATH)) {
    vapidKeys = JSON.parse(fs.readFileSync(VAPID_PATH, 'utf8'));
    return vapidKeys;
  }

  vapidKeys = webpush.generateVAPIDKeys();

  try {
    const keysDir = path.dirname(VAPID_PATH);
    if (!fs.existsSync(keysDir)) {
      fs.mkdirSync(keysDir, { recursive: true });
    }
    fs.writeFileSync(VAPID_PATH, JSON.stringify(vapidKeys, null, 2));
    console.log('Web Push VAPID keys generated');
  } catch (err) {
    console.warn('VAPID keys kept in memory only:', err.message);
  }

  return vapidKeys;
}

function ensureVapidConfigured() {
  const keys = loadOrCreateVapidKeys();
  webpush.setVapidDetails(config.vapidSubject, keys.publicKey, keys.privateKey);
}

function getVapidPublicKey() {
  ensureVapidConfigured();
  return loadOrCreateVapidKeys().publicKey;
}

async function sendWebPush(subscription, payload) {
  ensureVapidConfigured();
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      return { expired: true };
    }
    console.error('Web push failed:', err.message);
    return false;
  }
}

module.exports = {
  getVapidPublicKey,
  sendWebPush,
};
