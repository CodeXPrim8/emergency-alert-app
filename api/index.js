'use strict';

const path = require('path');
const fs = require('fs');

const backendRoot = path.join(__dirname, '..', 'backend');

function createErrorApp(express, message) {
  const app = express();
  app.use((req, res) => {
    res.status(500).json({
      error: 'Server unavailable. Try again in a moment.',
      ...(process.env.NODE_ENV !== 'production' && { detail: message }),
    });
  });
  return app;
}

let app;

try {
  if (!fs.existsSync(backendRoot)) {
    throw new Error(`Backend folder missing: ${backendRoot}`);
  }

  module.paths.unshift(path.join(backendRoot, 'node_modules'));
  process.chdir(backendRoot);

  process.env.USE_SQLITE = process.env.USE_SQLITE || 'true';
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';

  const { connectRedis } = require(path.join(backendRoot, 'src/db/redis'));
  const { initFirebase } = require(path.join(backendRoot, 'src/services/notifications'));
  const config = require(path.join(backendRoot, 'src/config'));
  const { createApp } = require(path.join(backendRoot, 'src/server'));

  connectRedis()
    .then(() => initFirebase(config.firebaseServiceAccountPath))
    .catch((err) => console.error('Background init failed:', err.message));

  app = createApp();
} catch (err) {
  console.error('Vercel bootstrap failed:', err);
  try {
    module.paths.unshift(path.join(backendRoot, 'node_modules'));
    const express = require('express');
    app = createErrorApp(express, err.message);
  } catch (fallbackErr) {
    app = (req, res) => {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Server unavailable', detail: fallbackErr.message }));
    };
  }
}

module.exports = app;
