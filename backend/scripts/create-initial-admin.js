const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const envPath = path.resolve(__dirname, '..', '.env');
require('dotenv').config({ path: envPath, quiet: true });
const { rpc } = require('../config/supabase');

const strongPassword = value => {
  const password = String(value || '');
  return password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password)
    && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
};

const clearInitialAdminPassword = () => {
  const original = fs.readFileSync(envPath, 'utf8');
  const cleared = /^INITIAL_ADMIN_PASSWORD=.*$/m.test(original)
    ? original.replace(/^INITIAL_ADMIN_PASSWORD=.*$/m, 'INITIAL_ADMIN_PASSWORD=')
    : `${original.replace(/\s*$/, '\n')}INITIAL_ADMIN_PASSWORD=\n`;

  fs.writeFileSync(envPath, cleared, { encoding: 'utf8', mode: 0o600 });
  process.env.INITIAL_ADMIN_PASSWORD = '';
};

(async () => {
  const suppliedName = String(process.env.INITIAL_ADMIN_NAME || '').trim();
  const email = String(process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.INITIAL_ADMIN_PASSWORD || '');

  if (suppliedName.length > 100) throw new Error('INITIAL_ADMIN_NAME must contain no more than 100 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {
    throw new Error('Set a valid INITIAL_ADMIN_EMAIL in backend/.env.');
  }
  if (!strongPassword(password)) {
    throw new Error('INITIAL_ADMIN_PASSWORD must be at least 12 characters and include uppercase, lowercase, a number, and a symbol.');
  }

  const hash = await bcrypt.hash(password, 12);
  const outcome = await rpc('tvtms_account_provision_admin', {
    p_email: email, p_name: suppliedName || null, p_password: hash
  });
  if (outcome.error) throw new Error(outcome.error);
  const adminStatus = outcome.status;

  clearInitialAdminPassword();
  console.log(`[ADMIN_STATUS] ${adminStatus}`);
  console.log('Administrator password was securely hashed; the temporary .env value was cleared.');
  process.exit(0);
})().catch(error => {
  console.error(`Administrator provisioning failed: ${error.message}`);
  process.exit(1);
});
