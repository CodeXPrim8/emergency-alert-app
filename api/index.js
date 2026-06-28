'use strict';

let app;

try {
  app = require('../backend/vercel');
} catch (err) {
  console.error('Backend bootstrap failed:', err);
  app = (req, res) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'Server startup failed',
      detail: err.message,
    }));
  };
}

module.exports = app;
