const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
const backendRoot = path.resolve(__dirname, '..');
const envPath = path.join(backendRoot, '.env');
const issues = [];
const warnings = [];

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) issues.push(`Node.js 20 or newer is required. Current version: ${process.version}`);

if (!fs.existsSync(envPath)) {
  issues.push('backend/.env is missing. Copy backend/.env.example to backend/.env and configure it.');
} else {
  const text = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }

  for (const key of ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET']) {
    if (!env[key]) issues.push(`${key} is missing in backend/.env.`);
  }
  const secret = String(env.JWT_SECRET || '');
  if (secret.length < 32 || /change-this|your-secret|secret-key/i.test(secret)) {
    issues.push('JWT_SECRET must be replaced with a unique random value of at least 32 characters.');
  }
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') {
    if (!env.ALLOWED_ORIGINS) issues.push('ALLOWED_ORIGINS is required in production.');
    if (!env.APP_PUBLIC_URL) issues.push('APP_PUBLIC_URL is required in production.');
    if (!env.DB_PASSWORD) warnings.push('DB_PASSWORD is empty. Use a dedicated database account with a strong password in production.');
    if (!/^https:\/\//i.test(env.APP_PUBLIC_URL || '')) warnings.push('APP_PUBLIC_URL should use HTTPS in production.');
    if (String(env.TRUST_PROXY || '0') !== '1') warnings.push('Set TRUST_PROXY=1 when the API runs behind a reverse proxy.');
  }
  if (!env.SMTP_USER || !env.SMTP_PASS) warnings.push('SMTP is not configured; password-reset and email notifications will not be delivered.');
  if (env.INITIAL_ADMIN_PASSWORD) warnings.push('Clear INITIAL_ADMIN_PASSWORD after the first administrator account is created.');
}

const required = [
  'frontend/pages/landing.html',
  'frontend/pages/login.html',
  'frontend/pages/admin-dashboard.html',
  'frontend/pages/officer-dashboard.html',
  'frontend/pages/public-ticket-lookup.html',
  'frontend/pages/reset-password.html',
  'backend/server.js',
  'backend/models/database.sql',
  'backend/package-lock.json'
];
for (const relative of required) {
  if (!fs.existsSync(path.join(projectRoot, relative))) issues.push(`Required file is missing: ${relative}`);
}

console.log('Municipal Traffic Violation System — Deployment Preflight');
console.log(`Node: ${process.version}`);
console.log(`Project: ${projectRoot}`);
console.log(`Checks: ${required.length + 5}`);

for (const warning of warnings) console.warn(`WARNING: ${warning}`);
if (issues.length) {
  for (const issue of issues) console.error(`ERROR: ${issue}`);
  process.exitCode = 1;
} else {
  console.log('Preflight passed. Continue with database backup, migration, and end-to-end acceptance testing.');
}
