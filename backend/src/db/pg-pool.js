const { Pool } = require('pg');
const config = require('../config');

const needsSsl =
  config.databaseUrl.includes('supabase.co')
  || (config.nodeEnv === 'production' && !config.databaseUrl.includes('localhost'));

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

module.exports = pool;
