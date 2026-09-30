const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, exec } = require('child_process');

const BLOCKLIST = [/\$system/, /\$fopen/, /\$fdisplay/, /\$fwrite/, /\$readmemh/, /\$readmemb/];

// Slug ko file path mein daalne se pehle sanitize karo (path traversal se bachne ke liye)
const SAFE_SLUG = /^[a-z0-9-]+$/;

// Resource limits — Phase 1-2 ke liye process-level isolation
const COMPILE_TIMEOUT_MS = 10000;   // compile step zyada der tak hang na kare
const RUN_TIMEOUT_MS = 5000;        // simulation ka TLE cutoff
const MEMORY_LIMIT_KB = 262144;     // ~256MB virtual memory cap (ulimit -v)
const CPU_TIME_LIMIT_S = 10;        // ulimit -t (seconds of CPU time)

// Compile/run dono steps ke liye ek shell prefix jo ulimit laga deta hai
const IS_WINDOWS = process.platform === 'win32';
const ULIMIT_PREFIX = IS_WINDOWS ? '' : `ulimit -v ${MEMORY_LIMIT_KB} -t ${CPU_TIME_LIMIT_S};`;

function judgeSubmission(code, problemSlug) {
    return new Promise((resolve) => {
        // 0. Security Guard: Invalid characters check
        if (!SAFE_SLUG.test(problemSlug)) {
            return resolve({ verdict: "CE", message: "Invalid problem reference.", execution_time: 0 });
        }

        // 1. Har submission ke liye alag temp directory
        let tmpDir;
        try {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-'));
        } catch (e) {
            return resolve({ verdict: "RE", message: "Could not allocate judge workspace.", execution_time: 0 });
        }

        const verilogFile = path.join(tmpDir, 'module.v');
        const simOut = path.join(tmpDir, 'sim.out');
        const testbenchFile = path.resolve(__dirname, '../../../problems', problemSlug, 'testbench.v');

        const cleanup = () => {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        };

        if (!fs.existsSync(testbenchFile)) {
            cleanup();
            return resolve({ verdict: "RE", message: "Testbench not found for this problem.", execution_time: 0 });
        }

        // 2. User ka code temp dir mein save karo
        fs.writeFileSync(verilogFile, code);

        // 3. Security Check (blocklist)
        for (let pattern of BLOCKLIST) {
            if (pattern.test(code)) {
                cleanup();
                return resolve({ verdict: "CE", message: "Restricted task detected by filter.", execution_time: 0 });
            }
        }

        // 4. Compile (timeout + memory/cpu ulimit ke saath)
        try {
            execSync(
                `${ULIMIT_PREFIX} iverilog -o "${simOut}" "${verilogFile}" "${testbenchFile}"`,
                { stdio: 'pipe', timeout: COMPILE_TIMEOUT_MS, cwd: tmpDir }
            );
        } catch (error) {
            cleanup();
            if (error.killed || error.signal === 'SIGTERM') {
                return resolve({ verdict: "TLE", message: "Compilation timed out.", execution_time: COMPILE_TIMEOUT_MS / 1000 });
            }
            
            // Extract the actual error message and hide the absolute server paths
            let ceMessage = "Compilation Error";
            const rawError = error.stderr ? error.stderr.toString() : (error.stdout ? error.stdout.toString() : "");
            if (rawError) {
                // Remove the tmpDir path from the error to avoid leaking server info
                // Replace both Windows and Unix slashes for tmpDir
                const escapedTmpDir = tmpDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(escapedTmpDir + '[\\\\/]', 'g');
                
                let cleanError = rawError.replace(regex, '');
                // Keep only the first few lines if it's too long
                const lines = cleanError.split('\n').filter(l => l.trim().length > 0);
                ceMessage = lines.slice(0, 3).join('\n'); // First 3 lines
            }
            
            return resolve({ verdict: "CE", message: ceMessage, execution_time: 0 });
        }

        // 5. Simulate & Timeout
        const startedAt = Date.now();
        exec(
            `${ULIMIT_PREFIX} vvp "${simOut}"`,
            { timeout: RUN_TIMEOUT_MS, cwd: tmpDir },
            (error, stdout, stderr) => {
                const executionTime = parseFloat(((Date.now() - startedAt) / 1000).toFixed(3));
                cleanup(); // Kachra saaf

                if (error) {
                    if (error.killed || error.signal === 'SIGTERM') {
                        return resolve({ verdict: "TLE", message: `Time Limit Exceeded (> ${RUN_TIMEOUT_MS / 1000}s)`, execution_time: executionTime });
                    } else {
                        return resolve({ verdict: "RE", message: "Runtime Error", execution_time: executionTime });
                    }
                } else {
                    if (stdout.includes("[JUDGE_RESULT: AC]")) {
                        return resolve({ verdict: "AC", message: "All test cases passed!", execution_time: executionTime });
                    } else if (stdout.includes("[JUDGE_RESULT: WA]")) {
                        // Extract specific failure message if the testbench provides it
                        const match = stdout.match(/Failed on Test Case: (.*)/);
                        const msg = match ? `Failed on Test Case: ${match[1]}` : "Wrong Answer on some test case.";
                        return resolve({ verdict: "WA", message: msg, execution_time: executionTime });
                    } else {
                        return resolve({ verdict: "RE", message: "Missing output marker.", execution_time: executionTime });
                    }
                }
            }
        );
    });
}

module.exports = { judgeSubmission };