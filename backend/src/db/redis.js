const Redis = require('ioredis');
const config = require('../config');

let redis = null;
let redisAvailable = false;

const GEO_KEY = 'users:locations';

async function connectRedis() {
  try {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    redis.on('error', () => {});
    await redis.connect();
    redisAvailable = true;
    console.log('Redis connected');
  } catch (err) {
    redisAvailable = false;
    if (redis) {
      redis.disconnect();
      redis = null;
    }
    console.warn('Redis connection failed (nearby alerts disabled):', err.message);
  }
}

async function setUserLocation(userId, longitude, latitude) {
  if (!redisAvailable || !redis) return;
  await redis.geoadd(GEO_KEY, longitude, latitude, userId);
}

async function removeUserLocation(userId) {
  if (!redisAvailable || !redis) return;
  await redis.zrem(GEO_KEY, userId);
}

async function findNearbyUsers(longitude, latitude, radiusMeters, excludeUserId) {
  if (!redisAvailable || !redis) return [];
  const results = await redis.georadius(
    GEO_KEY,
    longitude,
    latitude,
    radiusMeters,
    'm',
    'WITHDIST',
    'ASC'
  );
  return results
    .filter(([userId]) => userId !== excludeUserId)
    .map(([userId, distance]) => ({
      userId,
      distanceMeters: Math.round(parseFloat(distance)),
    }));
}

module.exports = {
  redis,
  connectRedis,
  setUserLocation,
  removeUserLocation,
  findNearbyUsers,
  GEO_KEY,
};
