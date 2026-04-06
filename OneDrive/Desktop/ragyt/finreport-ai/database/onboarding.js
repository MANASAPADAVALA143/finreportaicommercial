const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../onboarding.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS onboarding_clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT NOT NULL,
    country TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    email TEXT NOT NULL,
    whatsapp TEXT,
    financial_year TEXT,
    services TEXT,
    status TEXT DEFAULT 'intake',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS onboarding_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    document_name TEXT NOT NULL,
    priority TEXT NOT NULL,
    received INTEGER DEFAULT 0,
    verified INTEGER DEFAULT 0,
    verified_by_ai INTEGER DEFAULT 0,
    ai_reason TEXT,
    received_at DATETIME,
    FOREIGN KEY (client_id) REFERENCES onboarding_clients(id)
  );

  CREATE TABLE IF NOT EXISTS onboarding_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    template TEXT,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    delivered INTEGER DEFAULT 0,
    response_received INTEGER DEFAULT 0,
    FOREIGN KEY (client_id) REFERENCES onboarding_clients(id)
  );
`);

module.exports = db;
