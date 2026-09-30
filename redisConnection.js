const IORedis = require('ioredis');

const isTLS = (process.env.REDIS_URL || '').startsWith('rediss://');

const connection = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    tls: isTLS ? {} : undefined,
});

connection.on('error', (err) => {
    console.error('❌ Redis connection error:', err.message);
});

module.exports = { connection };