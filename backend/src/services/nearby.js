const pool = require('../db/pool');
const config = require('../config');
const { findNearbyUsers: findNearbyRedis, setUserLocation } = require('../db/redis');

const HAVERSINE_SQL = `
  SELECT id AS "userId",
    (6371000 * acos(
      MIN(1.0, MAX(-1.0,
        cos(radians(?)) * cos(radians(last_latitude)) *
        cos(radians(last_longitude) - radians(?)) +
        sin(radians(?)) * sin(radians(last_latitude))
      ))
    )) AS "distanceMeters"
  FROM users
  WHERE id != ?
    AND last_latitude IS NOT NULL
    AND last_longitude IS NOT NULL
    AND location_updated_at > datetime('now', '-30 minutes')
`;

const HAVERSINE_SQL_PG = `
  SELECT id AS "userId",
    (6371000 * acos(
      LEAST(1.0, GREATEST(-1.0,
        cos(radians($1)) * cos(radians(last_latitude)) *
        cos(radians(last_longitude) - radians($2)) +
        sin(radians($1)) * sin(radians(last_latitude))
      ))
    )) AS "distanceMeters"
  FROM users
  WHERE id != $3
    AND last_latitude IS NOT NULL
    AND last_longitude IS NOT NULL
    AND location_updated_at > NOW() - INTERVAL '30 minutes'
    AND (6371000 * acos(
      LEAST(1.0, GREATEST(-1.0,
        cos(radians($1)) * cos(radians(last_latitude)) *
        cos(radians(last_longitude) - radians($2)) +
        sin(radians($1)) * sin(radians(last_latitude))
      ))
    )) <= $4
  ORDER BY "distanceMeters" ASC
`;

async function findNearbyUsersInDatabase(longitude, latitude, radiusMeters, excludeUserId) {
  const isSqlite = config.useSqlite;
  let rows;

  if (isSqlite) {
    const result = await pool.query(HAVERSINE_SQL, [latitude, longitude, latitude, excludeUserId]);
    rows = result.rows.filter((r) => r.distanceMeters <= radiusMeters);
  } else {
    const result = await pool.query(HAVERSINE_SQL_PG, [
      latitude,
      longitude,
      excludeUserId,
      radiusMeters,
    ]);
    rows = result.rows;
  }

  return rows.map((r) => ({
    userId: r.userId,
    distanceMeters: Math.round(r.distanceMeters),
  }));
}

async function findNearbyUsers(longitude, latitude, radiusMeters, excludeUserId) {
  const redisResults = await findNearbyRedis(
    longitude,
    latitude,
    radiusMeters,
    excludeUserId
  );

  if (redisResults.length > 0) {
    return redisResults;
  }

  return findNearbyUsersInDatabase(longitude, latitude, radiusMeters, excludeUserId);
}

async function updateUserLocation(userId, latitude, longitude) {
  await pool.query(
    `UPDATE users SET last_latitude = $1, last_longitude = $2, location_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = $3`,
    [latitude, longitude, userId]
  );
  await setUserLocation(userId, longitude, latitude);
}

module.exports = {
  findNearbyUsers,
  findNearbyUsersInDatabase,
  updateUserLocation,
};
