const { Queue } = require('bullmq');
const { connection } = require('./redisConnection');


const judgeQueue = new Queue('judge-submissions', {
    connection,
    prefix: 'eceforces',
    defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 500,
    },
});

module.exports = { judgeQueue };