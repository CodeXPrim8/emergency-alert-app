const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const config = require('../config');

const VAPID_PATH = path.join(__dirname, '../../keys/vapid.json');

function loadOrCreateVapidKeys() {
  if (fs.existsSync(VAPID_PATH)) {
    return JSON.parse(fs.readFileSync(VAPID_PATH, 'utf8'));
  }

  const keysDir = path.dirname(VAPID_PATH);
  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true });
  }

  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_PATH, JSON.stringify(keys, null, 2));
  console.log('Web Push VAPID keys generated');
  return keys;
}

const vapidKeys = loadOrCreateVapidKeys();

webpush.setVapidDetails(
  config.vapidSubject,
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

function getVapidPublicKey() {
  return vapidKeys.publicKey;
}

async function sendWebPush(subscription, payload) {
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
