const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('../config/database');

const envPath = path.resolve(__dirname, '..', '.env');
require('dotenv').config({ path: envPath, quiet: true });

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
  const nameForCreation = suppliedName || 'System Administrator';
  const email = String(process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.INITIAL_ADMIN_PASSWORD || '');

  if (suppliedName.length > 100) throw new Error('INITIAL_ADMIN_NAME must contain no more than 100 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {
    throw new Error('Set a valid INITIAL_ADMIN_EMAIL in backend/.env.');
  }
  if (!strongPassword(password)) {
    throw new Error('INITIAL_ADMIN_PASSWORD must be at least 12 characters and include uppercase, lowercase, a number, and a symbol.');
  }

  const connection = await db.getConnection();
  let adminStatus;
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query(
      'SELECT id, role FROM users WHERE email = ? LIMIT 1 FOR UPDATE',
      [email]
    );

    if (existing.length && existing[0].role !== 'admin') {
      throw new Error(
        `Administrator provisioning stopped: the configured email belongs to role "${existing[0].role}". `
        + 'The existing account was not modified; choose a different Administrator email.'
      );
    }

    const hash = await bcrypt.hash(password, 12);
    if (existing.length) {
      const nameAssignment = suppliedName ? ', name = ?' : '';
      const values = [hash];
      if (suppliedName) values.push(suppliedName);
      values.push(existing[0].id);

      await connection.query(
        `UPDATE users
         SET password = ?${nameAssignment},
             status = 'active',
             failed_login_attempts = 0,
             locked_until = NULL,
             reset_token_hash = NULL,
             reset_token_expires = NULL
         WHERE id = ?`,
        values
      );
      adminStatus = 'UPDATED';
    } else {
      await connection.query(
        "INSERT INTO users(name, email, password, role, status, failed_login_attempts, locked_until) VALUES(?, ?, ?, 'admin', 'active', 0, NULL)",
        [nameForCreation, email, hash]
      );
      adminStatus = 'CREATED';
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  clearInitialAdminPassword();
  console.log(`[ADMIN_STATUS] ${adminStatus}`);
  console.log('Administrator password was securely hashed; the temporary .env value was cleared.');
  process.exit(0);
})().catch(error => {
  console.error(`Administrator provisioning failed: ${error.message}`);
  process.exit(1);
});
