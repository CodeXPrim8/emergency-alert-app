const config = require('../config');

const pool = config.useSqlite
  ? (process.env.VERCEL ? require('./vercel-sqljs') : require('./sqlite'))
  : require('./pg-pool');

module.exports = pool;
