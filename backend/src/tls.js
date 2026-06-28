const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

const KEYS_DIR = path.join(__dirname, '../keys');
const CERT_PATH = path.join(KEYS_DIR, 'tls-cert.pem');
const KEY_PATH = path.join(KEYS_DIR, 'tls-key.pem');

function loadOrCreateTlsCredentials() {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }

  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    return {
      cert: fs.readFileSync(CERT_PATH, 'utf8'),
      key: fs.readFileSync(KEY_PATH, 'utf8'),
    };
  }

  const attrs = [{ name: 'commonName', value: 'Emergency Alert Local' }];
  const pems = selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
  });

  fs.writeFileSync(CERT_PATH, pems.cert);
  fs.writeFileSync(KEY_PATH, pems.private);
  console.log('TLS certificate generated for HTTPS (required for iPhone GPS)');

  return { cert: pems.cert, key: pems.private };
}

module.exports = { loadOrCreateTlsCredentials };
