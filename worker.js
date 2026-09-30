const { Worker } = require('bullmq');
const { connection } = require('./redisConnection');
const { judgeSubmission } = require('./app/judge/runner');
const pool = require('./db');

const CONCURRENCY = parseInt(process.env.JUDGE_CONCURRENCY || '2', 10);

function startJudgeWorker(io) {
    const worker = new Worker(
        'judge-submissions',
        async (job) => {
            const { submissionId, code, problemSlug } = job.data;

            const result = await judgeSubmission(code, problemSlug);

            await pool.query(
                'UPDATE submissions SET verdict = $1, execution_time = $2 WHERE id = $3',
                [result.verdict, result.execution_time || 0, submissionId]
            );

            io.to(`submission:${submissionId}`).emit('verdict', {
                submissionId,
                verdict: result.verdict,
                message: result.message,
                execution_time: result.execution_time,
            });

            return result;
        },
        { connection, concurrency: CONCURRENCY, prefix: 'eceforces' }
    );

    worker.on('failed', (job, err) => {
        console.error(`Judge job ${job?.id} failed:`, err.message);
        if (job?.data?.submissionId) {
            io.to(`submission:${job.data.submissionId}`).emit('verdict', {
                submissionId: job.data.submissionId,
                verdict: 'RE',
                message: 'Judge worker encountered an internal error.',
                execution_time: 0,
            });
        }
    });

    console.log(`⚙️  Judge worker started (concurrency: ${CONCURRENCY})`);
    return worker;
}

module.exports = { startJudgeWorker };