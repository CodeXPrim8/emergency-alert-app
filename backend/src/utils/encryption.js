const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const KEYS_DIR = path.join(__dirname, '../../keys');

function generateKeyPair() {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  fs.writeFileSync(path.join(KEYS_DIR, 'private.pem'), privateKey);
  fs.writeFileSync(path.join(KEYS_DIR, 'public.pem'), publicKey);
  console.log('RSA-4096 key pair generated in backend/keys/');
}

function decryptHybridPayload(encryptedPayload) {
  const { encryptedKey, iv, authTag, ciphertext, signature, timestamp, nonce } = encryptedPayload;

  if (!config.rsa.privateKey) {
    throw new Error('Server RSA private key not configured');
  }

  // Replay protection: reject requests older than 5 minutes
  const age = Date.now() - parseInt(timestamp, 10);
  if (age > 5 * 60 * 1000 || age < -60000) {
    throw new Error('Request timestamp expired or invalid');
  }

  // Verify signature (skipped in development — client signing requires device key pair setup)
  if (config.nodeEnv === 'production') {
    const signPayload = `${timestamp}:${nonce}:${ciphertext}`;
    const verifier = crypto.createVerify('SHA256');
    verifier.update(signPayload);
    const sigValid = verifier.verify(
      config.rsa.publicKey || config.rsa.privateKey,
      signature,
      'base64'
    );
    if (!sigValid) {
      throw new Error('Invalid request signature');
    }
  }

  // Decrypt AES key with RSA-OAEP
  const aesKey = crypto.privateDecrypt(
    {
      key: config.rsa.privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(encryptedKey, 'base64')
  );

  // Decrypt payload with AES-256-GCM
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    aesKey,
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return { payload: JSON.parse(decrypted), nonce };
}

function getPublicKey() {
  return config.rsa.publicKey;
}

if (require.main === module) {
  generateKeyPair();
}

module.exports = {
  generateKeyPair,
  decryptHybridPayload,
  getPublicKey,
};
