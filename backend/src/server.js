const express = require('express');
const https = require('https');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const { connectRedis } = require('./db/redis');
const { initFirebase } = require('./services/notifications');
const { loadOrCreateTlsCredentials } = require('./tls');

const authRoutes = require('./routes/auth');
const emergencyRoutes = require('./routes/emergency');
const contactsRoutes = require('./routes/contacts');
const locationRoutes = require('./routes/location');
const pushRoutes = require('./routes/push');
const os = require('os');

function createApp() {
  const app = express();

  if (process.env.VERCEL) {
    app.use((req, res, next) => {
      const url = req.originalUrl || req.url;
      if (!url.startsWith('/api') && (url.startsWith('/v1/') || url === '/health')) {
        req.url = `/api${url}`;
      }
      next();
    });
  }

  app.use(helmet({
    contentSecurityPolicy: config.nodeEnv === 'development' ? false : undefined,
  }));
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), secure: req.secure });
  });

  app.get('/api/v1/info', (req, res) => {
    const lanIps = getLanAddresses();
    const httpPort = config.port;
    const httpsPort = config.httpsPort;
    const primaryIp = lanIps[0] || 'localhost';

    res.json({
      port: httpPort,
      httpsPort,
      phoneUrls: lanIps.map((ip) => `http://${ip}:${httpPort}`),
      httpsPhoneUrls: lanIps.map((ip) => `https://${ip}:${httpsPort}`),
      primaryPhoneUrl: `https://${primaryIp}:${httpsPort}`,
      httpPhoneUrl: `http://${primaryIp}:${httpPort}`,
      installable: true,
      gpsRequiresHttps: true,
    });
  });

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1', emergencyRoutes);
  app.use('/api/v1/contacts', contactsRoutes);
  app.use('/api/v1', locationRoutes);
  app.use('/api/v1/push', pushRoutes);
  app.use('/api/v1/emergency', require('./routes/media'));
  app.use('/api/v1/hardware', require('./routes/hardware'));

  app.use(express.static(path.join(__dirname, '../public')));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css')) {
      return next();
    }
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }
  return ips;
}

function logUrls() {
  const lanIps = getLanAddresses();
  console.log(`HTTP  Local:   http://localhost:${config.port}`);
  console.log(`HTTPS Local:   https://localhost:${config.httpsPort}`);
  lanIps.forEach((ip) => {
    console.log(`HTTP  Network: http://${ip}:${config.port}`);
    console.log(`HTTPS Network: https://${ip}:${config.httpsPort}  ← use this on phones for GPS`);
  });
  if (lanIps.length > 0) {
    console.log('Phones: open the HTTPS Network URL (accept the security warning once)');
  }
}

async function start() {
  if (config.useSqlite) {
    console.log('Using SQLite database (development mode)');
  }
  await connectRedis();
  initFirebase(config.firebaseServiceAccountPath);

  const app = createApp();
  const host = config.host;
  const tls = loadOrCreateTlsCredentials();

  app.listen(config.port, host, () => {
    console.log(`Emergency Alert API (HTTP) on port ${config.port}`);
  });

  https.createServer({ cert: tls.cert, key: tls.key }, app).listen(config.httpsPort, host, () => {
    console.log(`Emergency Alert API (HTTPS) on port ${config.httpsPort}`);
    logUrls();
    console.log(`Environment: ${config.nodeEnv}`);
  });
}

module.exports = { createApp, start };

if (require.main === module) {
  start().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
