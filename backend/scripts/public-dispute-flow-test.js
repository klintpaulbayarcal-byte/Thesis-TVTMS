// Public filing, payment protection and rollback checks use an in-memory test database.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, ['--test', path.join(__dirname, '../tests/payments-public.test.js')], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
