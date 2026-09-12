// Ownership and deletion checks run against isolated fixtures, never live notifications.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, ['--test', path.join(__dirname, '../tests/notifications.test.js')], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
