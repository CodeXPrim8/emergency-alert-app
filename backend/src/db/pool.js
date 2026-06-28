const config = require('../config');

const pool = config.useSqlite
  ? require('./sqlite')
  : require('./pg-pool');

module.exports = pool;
