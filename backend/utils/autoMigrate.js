const db = require('../config/database');

const columnExists = async (table, column) => {
    const [rows] = await db.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
        [table, column]
    );
    return rows.length > 0;
};

async function autoMigrate() {
    console.log('Running safe database migrations...');

    await db.query(`
        CREATE TABLE IF NOT EXISTS ticket_number_sequences (
            sequence_year SMALLINT PRIMARY KEY,
            last_number INT NOT NULL DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS owners (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(100),
            email VARCHAR(100),
            address TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_owner_email (email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS ticket_status_history (
            id INT PRIMARY KEY AUTO_INCREMENT,
            ticket_id INT NOT NULL,
            previous_status VARCHAR(30) NULL,
            new_status VARCHAR(30) NOT NULL,
            changed_by INT NOT NULL,
            reason TEXT NULL,
            approver_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_status_history_ticket (ticket_id),
            INDEX idx_status_history_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS evidence (
            id INT PRIMARY KEY AUTO_INCREMENT,
            ticket_id INT NOT NULL,
            file_path VARCHAR(255) NOT NULL,
            file_name VARCHAR(255),
            file_type VARCHAR(50),
            file_size INT,
            uploaded_by INT NOT NULL,
            gps_lat DECIMAL(10,7) NULL,
            gps_lng DECIMAL(10,7) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_evidence_ticket (ticket_id),
            INDEX idx_evidence_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS contact_messages (
            id INT PRIMARY KEY AUTO_INCREMENT,
            full_name VARCHAR(120) NOT NULL,
            email VARCHAR(190) NOT NULL,
            subject VARCHAR(150) NOT NULL,
            message TEXT NOT NULL,
            status ENUM('new', 'read', 'archived') NOT NULL DEFAULT 'new',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_contact_status_created (status, created_at),
            INDEX idx_contact_email (email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Expand temporarily so legacy values can be converted without truncation.
    await db.query(`ALTER TABLE users MODIFY role ENUM('admin','enforcer','apprehending_officer','driver') NOT NULL DEFAULT 'apprehending_officer'`);
    await db.query(`UPDATE users SET role='apprehending_officer' WHERE role='enforcer'`);
    const [[legacyDrivers]] = await db.query(`SELECT COUNT(*) AS total FROM users WHERE role='driver'`);
    if (Number(legacyDrivers.total) > 0) {
        // Preserve legacy records instead of deleting accounts or silently changing
        // their role. Authentication rejects this unsupported role, while keeping
        // the expanded ENUM allows the rest of the safe startup migration to run.
        console.warn(`WARNING: ${legacyDrivers.total} legacy driver account(s) were preserved with login disabled.`);
    } else {
        await db.query(`ALTER TABLE users MODIFY role ENUM('admin','apprehending_officer') NOT NULL DEFAULT 'apprehending_officer'`);
    }

    const userColumns = [
        ['failed_login_attempts', `ALTER TABLE users ADD COLUMN failed_login_attempts INT NOT NULL DEFAULT 0 AFTER status`],
        ['locked_until', `ALTER TABLE users ADD COLUMN locked_until DATETIME NULL AFTER failed_login_attempts`],
        ['reset_token_hash', `ALTER TABLE users ADD COLUMN reset_token_hash VARCHAR(64) NULL AFTER locked_until`],
        ['reset_token_expires', `ALTER TABLE users ADD COLUMN reset_token_expires DATETIME NULL AFTER reset_token_hash`],
        ['last_login', `ALTER TABLE users ADD COLUMN last_login DATETIME NULL AFTER reset_token_expires`]
    ];
    for (const [column, statement] of userColumns) {
        if (!(await columnExists('users', column))) await db.query(statement);
    }

    if (!(await columnExists('vehicles', 'driver_license_number'))) {
        await db.query(`ALTER TABLE vehicles ADD COLUMN driver_license_number VARCHAR(30) NULL AFTER owner_email`);
    }
    if (!(await columnExists('vehicles', 'owner_id'))) {
        await db.query(`ALTER TABLE vehicles ADD COLUMN owner_id INT NULL AFTER owner_address`);
    }
    if (!(await columnExists('tickets', 'penalty_amount_at_issue'))) {
        await db.query(`ALTER TABLE tickets ADD COLUMN penalty_amount_at_issue DECIMAL(10,2) NULL AFTER violation_id`);
        await db.query(`UPDATE tickets t JOIN violations v ON t.violation_id = v.id SET t.penalty_amount_at_issue = v.penalty_amount WHERE t.penalty_amount_at_issue IS NULL`);
    }
    if (!(await columnExists('payments', 'payment_status'))) {
        await db.query(`ALTER TABLE payments ADD COLUMN payment_status ENUM('partial','full','voided') NOT NULL DEFAULT 'full' AFTER payment_method`);
    }
    if (!(await columnExists('notifications', 'read_at'))) {
        await db.query(`ALTER TABLE notifications ADD COLUMN read_at DATETIME NULL AFTER is_read`);
    }
    if (!(await columnExists('disputes', 'contact_name'))) {
        await db.query(`ALTER TABLE disputes ADD COLUMN contact_name VARCHAR(120) NULL AFTER submitted_by`);
    }
    if (!(await columnExists('disputes', 'contact_email'))) {
        await db.query(`ALTER TABLE disputes ADD COLUMN contact_email VARCHAR(190) NULL AFTER contact_name`);
    }
    if (!(await columnExists('disputes', 'submission_source'))) {
        await db.query(`ALTER TABLE disputes ADD COLUMN submission_source ENUM('internal','public') NOT NULL DEFAULT 'internal' AFTER contact_email`);
    }
    await db.query(`ALTER TABLE disputes MODIFY submitted_by INT NULL`);

    const evidenceColumns = [
        ['file_name', `ALTER TABLE evidence ADD COLUMN file_name VARCHAR(255) NULL AFTER file_path`],
        ['file_type', `ALTER TABLE evidence ADD COLUMN file_type VARCHAR(50) NULL AFTER file_name`],
        ['file_size', `ALTER TABLE evidence ADD COLUMN file_size INT NULL AFTER file_type`],
        ['gps_lat', `ALTER TABLE evidence ADD COLUMN gps_lat DECIMAL(10,7) NULL AFTER uploaded_by`],
        ['gps_lng', `ALTER TABLE evidence ADD COLUMN gps_lng DECIMAL(10,7) NULL AFTER gps_lat`]
    ];
    for (const [column, statement] of evidenceColumns) {
        if (!(await columnExists('evidence', column))) await db.query(statement);
    }

    const historyColumns = [
        ['previous_status', `ALTER TABLE ticket_status_history ADD COLUMN previous_status VARCHAR(30) NULL AFTER ticket_id`],
        ['new_status', `ALTER TABLE ticket_status_history ADD COLUMN new_status VARCHAR(30) NULL AFTER previous_status`],
        ['changed_by', `ALTER TABLE ticket_status_history ADD COLUMN changed_by INT NULL AFTER new_status`],
        ['reason', `ALTER TABLE ticket_status_history ADD COLUMN reason TEXT NULL AFTER changed_by`],
        ['approver_id', `ALTER TABLE ticket_status_history ADD COLUMN approver_id INT NULL AFTER reason`]
    ];
    for (const [column, statement] of historyColumns) {
        if (!(await columnExists('ticket_status_history', column))) await db.query(statement);
    }

    await db.query(`
        CREATE OR REPLACE VIEW ticket_details AS
        SELECT t.id, t.ticket_number, t.date_issued, t.time_issued, t.location, t.remarks,
               t.status, t.payment_date, t.user_id,
               COALESCE(t.penalty_amount_at_issue, viol.penalty_amount) AS penalty_amount,
               t.penalty_amount_at_issue, u.name AS officer_name,
               v.plate_number, v.vehicle_type, v.owner_name, v.owner_email,
               v.owner_address, v.driver_license_number,
               viol.violation_code, viol.violation_name, viol.demerit_points,
               t.created_at, t.updated_at
        FROM tickets t
        JOIN users u ON t.user_id=u.id
        JOIN vehicles v ON t.vehicle_id=v.id
        JOIN violations viol ON t.violation_id=viol.id
    `);

    await db.query(`
        INSERT INTO system_settings (setting_key, setting_value, description) VALUES
        ('system_title','Municipal Traffic Violation Ticketing and Management System','System title'),
        ('lgu_name','Municipality of Calape','Name of the LGU'),
        ('lgu_address','Calape, Bohol','Address of the LGU'),
        ('lgu_contact','','Official LGU contact number'),
        ('dispute_deadline_days','15','Days allowed for filing a dispute'),
        ('payment_deadline_days','30','Days before a ticket is considered overdue'),
        ('send_violation_notice','1','Send violation notice emails when SMTP is configured'),
        ('send_payment_confirmation','1','Send payment confirmation emails when SMTP is configured')
        ON DUPLICATE KEY UPDATE setting_key=VALUES(setting_key)
    `);

    console.log('Safe database migrations completed.');
    return true;
}

module.exports = autoMigrate;
