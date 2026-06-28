require('dotenv').config();
const fs = require('fs');
const path = require('path');

function loadKey(envPath, fallbackName) {
  const keyPath = process.env[envPath] || path.join(__dirname, '../../keys', fallbackName);
  try {
    return fs.readFileSync(path.resolve(keyPath), 'utf8');
  } catch {
    return null;
  }
}

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  httpsPort: parseInt(process.env.HTTPS_PORT, 10) || 3443,
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  useSqlite: process.env.USE_SQLITE === 'true',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/emergency_alert',
  sqlitePath: process.env.SQLITE_PATH || path.join(__dirname, '../../data/emergency_alert.db'),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '365d',
  },
  rsa: {
    privateKey: loadKey('RSA_PRIVATE_KEY_PATH', 'private.pem'),
    publicKey: loadKey('RSA_PUBLIC_KEY_PATH', 'public.pem'),
  },
  firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
  nearbyRadiusMeters: parseInt(process.env.NEARBY_RADIUS_METERS, 10) || 3000,
  alertCancelGraceSeconds: parseInt(process.env.ALERT_CANCEL_GRACE_SECONDS, 10) || 30,
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:emergency@localhost',
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  },
};
