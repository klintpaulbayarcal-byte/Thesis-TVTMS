-- ============================================================
-- Municipal Traffic Violation Ticketing and Management System
-- Author: Klint Paul R. Bayarcal
-- Institution: Bohol Island State University - Calape Campus
-- Scope: municipal traffic enforcement and records management
-- Production note: validate local legal authority, ordinances, violation definitions,
-- and penalty amounts with the authorized LGU office before go-live.
-- ============================================================
-- IMPORTANT: Run this single file only. All previous migration
-- files are already merged here. Do NOT run them separately.
-- ============================================================

CREATE DATABASE IF NOT EXISTS violation_system;
USE violation_system;

-- TABLE: users
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'apprehending_officer') NOT NULL DEFAULT 'apprehending_officer',
    contact_number VARCHAR(20),
    plate_number VARCHAR(20) NULL,
    status ENUM('active', 'inactive') DEFAULT 'active',
    failed_login_attempts INT DEFAULT 0,
    locked_until DATETIME NULL,
    reset_token_hash VARCHAR(64) NULL,
    reset_token_expires DATETIME NULL,
    last_login DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_role (role),
    INDEX idx_plate_number (plate_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- TABLE: owners
CREATE TABLE IF NOT EXISTS owners (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100),
    email VARCHAR(100),
    address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_owner_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- TABLE: vehicles
CREATE TABLE IF NOT EXISTS vehicles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    plate_number VARCHAR(20) UNIQUE NOT NULL,
    vehicle_type ENUM('motorcycle', 'tricycle', 'car', 'truck', 'bus', 'van') NOT NULL,
    owner_name VARCHAR(100),
    owner_email VARCHAR(100),
    driver_license_number VARCHAR(30) NULL COMMENT 'For repeat offender search by license number (panel requirement)',
    owner_address TEXT,
    owner_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL,
    INDEX idx_plate (plate_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- TABLE: violations
CREATE TABLE IF NOT EXISTS violations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    violation_code VARCHAR(20) UNIQUE NOT NULL,
    violation_name VARCHAR(150) NOT NULL,
    description TEXT,
    penalty_amount DECIMAL(10, 2) NOT NULL,
    demerit_points INT DEFAULT 0,
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_code (violation_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- TABLE: violation_penalty_rules (escalating fines for repeat offenders)
CREATE TABLE IF NOT EXISTS violation_penalty_rules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    violation_id INT NOT NULL,
    offense_count INT NOT NULL,
    penalty_amount DECIMAL(10,2) NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    FOREIGN KEY (violation_id) REFERENCES violations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- TABLE: tickets
CREATE TABLE IF NOT EXISTS tickets (
    id INT PRIMARY KEY AUTO_INCREMENT,
    ticket_number VARCHAR(30) UNIQUE NOT NULL,
    user_id INT NOT NULL,
    vehicle_id INT NOT NULL,
    violation_id INT NOT NULL,
    penalty_amount_at_issue DECIMAL(10,2) NULL,
    date_issued DATE NOT NULL,
    time_issued TIME NOT NULL,
    location VARCHAR(200),
    remarks TEXT,
    status ENUM('unpaid', 'paid', 'cancelled') DEFAULT 'unpaid',
    payment_date DATE NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE RESTRICT,
    FOREIGN KEY (violation_id) REFERENCES violations(id) ON DELETE RESTRICT,
    INDEX idx_ticket_number (ticket_number),
    INDEX idx_status (status),
    INDEX idx_date (date_issued)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- TABLE: ticket_number_sequences (atomic yearly ticket numbering)
CREATE TABLE IF NOT EXISTS ticket_number_sequences (
    sequence_year SMALLINT PRIMARY KEY,
    last_number INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- TABLE: ticket_status_history
CREATE TABLE IF NOT EXISTS ticket_status_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    ticket_id INT NOT NULL,
    previous_status VARCHAR(30) NULL,
    new_status VARCHAR(30) NOT NULL,
    changed_by INT NOT NULL,
    reason TEXT NULL,
    approver_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- TABLE: payments
CREATE TABLE IF NOT EXISTS payments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    ticket_id INT NOT NULL,
    amount_paid DECIMAL(10,2) NOT NULL,
    official_receipt_number VARCHAR(50) UNIQUE NOT NULL,
    payment_method ENUM('cash', 'gcash', 'maya', 'bank_transfer', 'other') DEFAULT 'cash',
    payment_status ENUM('partial', 'full', 'voided') NOT NULL DEFAULT 'full',
    payment_date DATE NOT NULL,
    notes TEXT,
    recorded_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE RESTRICT,
    FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT,
    INDEX idx_or_number (official_receipt_number),
    INDEX idx_payment_status (payment_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- TABLE: disputes
CREATE TABLE IF NOT EXISTS disputes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    ticket_id INT NOT NULL,
    submitted_by INT NULL,
    contact_name VARCHAR(120) NULL,
    contact_email VARCHAR(190) NULL,
    submission_source ENUM('internal', 'public') NOT NULL DEFAULT 'internal',
    reason TEXT NOT NULL,
    status ENUM('submitted', 'under_review', 'approved', 'rejected', 'closed') DEFAULT 'submitted',
    resolution_notes TEXT,
    resolved_by INT NULL,
    resolved_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE RESTRICT,
    FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- TABLE: evidence (photo attachments)
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
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- TABLE: notifications
CREATE TABLE IF NOT EXISTS notifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(150) NOT NULL,
    message TEXT,
    is_read TINYINT(1) DEFAULT 0,
    read_at DATETIME NULL,
    reference_type VARCHAR(50),
    reference_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- TABLE: contact_messages (public landing-page inquiries)
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- TABLE: audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id INT,
    metadata JSON,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_action (action),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- TABLE: system_settings
CREATE TABLE IF NOT EXISTS system_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- VIEWS
CREATE OR REPLACE VIEW ticket_details AS
SELECT
    t.id,
    t.ticket_number,
    t.date_issued,
    t.time_issued,
    t.location,
    t.status,
    t.payment_date,
    t.user_id,
    COALESCE(t.penalty_amount_at_issue, viol.penalty_amount) AS penalty_amount,
    t.penalty_amount_at_issue,
    u.name AS officer_name,
    v.plate_number,
    v.vehicle_type,
    v.owner_name,
    v.owner_email,
    v.owner_address,
    v.driver_license_number,
    viol.violation_code,
    viol.violation_name,
    viol.demerit_points
FROM tickets t
JOIN users u ON t.user_id = u.id
JOIN vehicles v ON t.vehicle_id = v.id
JOIN violations viol ON t.violation_id = viol.id;

CREATE OR REPLACE VIEW daily_stats AS
SELECT
    DATE(date_issued) AS date,
    COUNT(*) AS total_tickets,
    SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_tickets,
    SUM(CASE WHEN status = 'unpaid' THEN 1 ELSE 0 END) AS unpaid_tickets,
    SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_tickets
FROM tickets
GROUP BY DATE(date_issued);

-- Ticket numbers are allocated atomically through ticket_number_sequences.

-- INDEXES are declared with their tables above.

-- STARTER REFERENCE DATA
-- Review and approve every violation definition and penalty before production use.
-- Production accounts are created with: npm run create-admin

INSERT IGNORE INTO violations (violation_code, violation_name, description, penalty_amount, demerit_points) VALUES
('V001', 'No Helmet', 'Driver or passenger not wearing helmet within municipality', 500.00, 3),
('V002', 'No License', 'Driving without valid license within LGU jurisdiction', 1000.00, 5),
('V003', 'No Registration', 'Vehicle not registered or expired registration', 2000.00, 5),
('V004', 'Overspeeding', 'Exceeding municipal speed limit', 1000.00, 4),
('V005', 'Reckless Driving', 'Driving in a reckless manner on local roads', 2000.00, 6),
('V006', 'Invalid Plate Number', 'Using invalid or tampered plate number', 2000.00, 5),
('V007', 'Triple Riding', 'More than two persons on a motorcycle', 500.00, 2),
('V008', 'Illegal Parking', 'Parking in area prohibited by local ordinance', 300.00, 1),
('V009', 'No Signal Light', 'Not using signal lights when turning on local roads', 300.00, 1),
('V010', 'Swerving', 'Abrupt lane changing without signal', 500.00, 2),
('V011', 'Counterflow', 'Driving against traffic flow on local roads', 1000.00, 4),
('V012', 'Disregarding Traffic Signs', 'Ignoring local traffic signs and signals', 500.00, 3),
('V013', 'Using Mobile Phone While Driving', 'Using mobile phone while driving on local roads', 500.00, 2),
('V014', 'No Side Mirror', 'Operating vehicle without side mirrors', 300.00, 1),
('V015', 'Defective Lights', 'Broken or non-functional headlights/taillights', 500.00, 2);

-- Vehicle and owner records are created through authorized system workflows.

INSERT IGNORE INTO system_settings (setting_key, setting_value, description) VALUES
('lgu_name', 'Municipality of Calape', 'Name of the LGU'),
('lgu_address', 'Calape, Bohol', 'Address of the LGU'),
('lgu_contact', '', 'Official LGU contact number'),
('dispute_deadline_days', '15', 'Number of days after ticket issuance during which disputes can be filed'),
('system_title', 'Municipal Traffic Violation Ticketing and Management System', 'System title shown in headers and reports'),
('payment_deadline_days', '30', 'Number of days before a ticket is considered overdue'),
('send_violation_notice', '1', 'Send violation notice emails when SMTP is configured'),
('send_payment_confirmation', '1', 'Send payment confirmation emails when SMTP is configured');
