CREATE DATABASE IF NOT EXISTS credit_tracker
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE credit_tracker;

CREATE TABLE IF NOT EXISTS store_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  store_name VARCHAR(120) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'PHP',
  CONSTRAINT chk_single_store CHECK (id = 1)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS owner_accounts (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  username VARCHAR(40) NOT NULL UNIQUE,
  password_salt CHAR(32) NOT NULL,
  password_hash CHAR(128) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_single_owner CHECK (id = 1)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS owner_sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  owner_id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  CONSTRAINT fk_sessions_owner
    FOREIGN KEY (owner_id) REFERENCES owner_accounts(id)
    ON DELETE CASCADE,
  INDEX idx_sessions_expiry (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  phone VARCHAR(32) NOT NULL DEFAULT '',
  purok VARCHAR(80) NOT NULL,
  credit_limit DECIMAL(12,2) NOT NULL,
  status ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL,
  INDEX idx_customers_name (name),
  CONSTRAINT chk_customer_credit_limit CHECK (credit_limit > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS applications (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  type ENUM('newCustomer', 'limitIncrease') NOT NULL DEFAULT 'newCustomer',
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  customer_name VARCHAR(80) NOT NULL,
  phone VARCHAR(32) NOT NULL DEFAULT '',
  purok VARCHAR(80) NOT NULL DEFAULT '',
  requested_limit DECIMAL(12,2) NOT NULL,
  note VARCHAR(240) NOT NULL DEFAULT '',
  customer_id VARCHAR(36) NULL,
  created_at DATETIME NOT NULL,
  reviewed_at DATETIME NULL,
  INDEX idx_applications_status_created (status, created_at),
  CONSTRAINT fk_applications_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id)
    ON DELETE SET NULL,
  CONSTRAINT chk_application_limit CHECK (requested_limit > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transactions (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  customer_id VARCHAR(36) NOT NULL,
  type ENUM('credit', 'payment') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  note VARCHAR(240) NOT NULL DEFAULT '',
  transaction_date DATE NOT NULL,
  due_date DATE NULL,
  created_at DATETIME NOT NULL,
  voided_at DATETIME NULL,
  void_reason VARCHAR(240) NOT NULL DEFAULT '',
  INDEX idx_transactions_customer_date (customer_id, transaction_date, created_at),
  INDEX idx_transactions_due_date (due_date),
  CONSTRAINT fk_transactions_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_transaction_amount CHECK (amount > 0),
  CONSTRAINT chk_credit_due_date CHECK (type <> 'credit' OR due_date IS NOT NULL),
  CONSTRAINT chk_payment_due_date CHECK (type <> 'payment' OR due_date IS NULL)
) ENGINE=InnoDB;

INSERT IGNORE INTO store_settings (id, store_name, currency)
VALUES (1, 'BURNICO SARI-SARI Store', 'PHP');

INSERT IGNORE INTO customers (id, name, phone, purok, credit_limit, status, created_at) VALUES
  ('cus-maria-santos', 'Maria Santos', '0917 123 4567', 'Purok 3', 1000.00, 'active', '2026-09-12 08:00:00'),
  ('cus-juan-dela-cruz', 'Juan Dela Cruz', '0918 123 4567', 'Purok 1', 500.00, 'active', '2026-09-15 08:00:00'),
  ('cus-lorna-cruz', 'Lorna Cruz', '0920 555 0142', 'Purok 2', 800.00, 'active', '2026-09-17 08:00:00'),
  ('cus-tonyo-bautista', 'Tonyo Bautista', '0935 777 0198', 'Purok 4', 300.00, 'active', '2026-09-20 08:00:00');

INSERT IGNORE INTO applications (id, type, status, customer_name, phone, purok, requested_limit, note, created_at)
VALUES ('app-pedro-reyes', 'newCustomer', 'pending', 'Pedro Reyes', '', 'Purok 2', 500.00, 'New customer credit request', '2026-10-25 08:00:00');

INSERT IGNORE INTO transactions (id, customer_id, type, amount, note, transaction_date, due_date, created_at) VALUES
  ('txn-maria-first-credit', 'cus-maria-santos', 'credit', 200.00, 'Rice and canned goods', '2026-10-05', '2026-10-20', '2026-10-05 09:00:00'),
  ('txn-maria-payment', 'cus-maria-santos', 'payment', 150.00, 'Cash payment', '2026-10-12', NULL, '2026-10-12 10:00:00'),
  ('txn-maria-second-credit', 'cus-maria-santos', 'credit', 300.00, 'Cooking oil, sugar, and coffee', '2026-10-15', '2026-10-30', '2026-10-15 09:00:00'),
  ('txn-juan-credit', 'cus-juan-dela-cruz', 'credit', 120.00, 'Noodles and soft drinks', '2026-10-12', '2026-10-22', '2026-10-12 09:00:00'),
  ('txn-juan-payment', 'cus-juan-dela-cruz', 'payment', 120.00, 'Paid in full', '2026-10-18', NULL, '2026-10-18 11:00:00'),
  ('txn-lorna-credit', 'cus-lorna-cruz', 'credit', 450.00, 'Household groceries', '2026-10-08', '2026-10-13', '2026-10-08 09:00:00'),
  ('txn-tonyo-credit', 'cus-tonyo-bautista', 'credit', 280.00, 'Canned goods and bread', '2026-10-20', '2026-10-30', '2026-10-20 09:00:00');
