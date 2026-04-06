const express = require('express');
const router = express.Router();
const db = require('../database/onboarding');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ─── File storage ─────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads', String(req.params.id || 'tmp'));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const docId = req.body.document_id || 'unknown';
    const ext = path.extname(file.originalname);
    cb(null, `doc_${docId}_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /pdf|jpe?g|png|docx?|xlsx?/i;
    if (allowed.test(path.extname(file.originalname))) return cb(null, true);
    cb(new Error('Only PDF, JPG, PNG, DOCX, XLSX files are allowed'));
  }
});

// ─── Country + Entity Checklists ─────────────────────────────────────────────

const CHECKLISTS = {
  India: {
    'Private Limited': [
      { name: 'PAN Card (Company)', priority: 'critical' },
      { name: 'Certificate of Incorporation', priority: 'critical' },
      { name: 'Memorandum & Articles of Association', priority: 'critical' },
      { name: 'GST Registration Certificate', priority: 'critical' },
      { name: 'Latest ITR (2 years)', priority: 'critical' },
      { name: 'Audited Financial Statements (2 years)', priority: 'critical' },
      { name: 'Bank Statements (6 months)', priority: 'critical' },
      { name: 'Director PAN & Aadhaar', priority: 'critical' },
      { name: 'TDS Returns (Form 26AS)', priority: 'important' },
      { name: 'Director KYC (DIN)', priority: 'important' },
      { name: 'Share Certificate', priority: 'important' },
      { name: 'Board Resolution', priority: 'important' },
      { name: 'MSME Registration', priority: 'optional' },
      { name: 'Import Export Code', priority: 'optional' },
      { name: 'Professional Tax Registration', priority: 'optional' }
    ],
    'LLP': [
      { name: 'PAN Card (LLP)', priority: 'critical' },
      { name: 'LLP Agreement', priority: 'critical' },
      { name: 'Certificate of Incorporation (LLP)', priority: 'critical' },
      { name: 'GST Registration Certificate', priority: 'critical' },
      { name: 'Latest ITR (2 years)', priority: 'critical' },
      { name: 'Bank Statements (6 months)', priority: 'critical' },
      { name: 'Partner PAN & Aadhaar', priority: 'critical' },
      { name: 'Designated Partner Certificate (DPIN)', priority: 'important' },
      { name: 'Annual Return (Form 11)', priority: 'important' },
      { name: 'Statement of Accounts (Form 8)', priority: 'important' },
      { name: 'MSME Registration', priority: 'optional' }
    ],
    'Sole Proprietorship': [
      { name: 'Proprietor PAN Card', priority: 'critical' },
      { name: 'Aadhaar Card', priority: 'critical' },
      { name: 'GST Registration Certificate', priority: 'critical' },
      { name: 'Latest ITR (2 years)', priority: 'critical' },
      { name: 'Bank Statements (6 months)', priority: 'critical' },
      { name: 'Shop & Establishment Certificate', priority: 'important' },
      { name: 'Business Address Proof', priority: 'important' },
      { name: 'MSME Registration', priority: 'optional' }
    ],
    'Partnership Firm': [
      { name: 'PAN Card (Firm)', priority: 'critical' },
      { name: 'Partnership Deed', priority: 'critical' },
      { name: 'GST Registration Certificate', priority: 'critical' },
      { name: 'Latest ITR (2 years)', priority: 'critical' },
      { name: 'Bank Statements (6 months)', priority: 'critical' },
      { name: 'Partner PAN Cards', priority: 'critical' },
      { name: 'Firm Registration Certificate', priority: 'important' },
      { name: 'MSME Registration', priority: 'optional' }
    ]
  },
  UK: {
    'Limited Company': [
      { name: 'Companies House Certificate of Incorporation', priority: 'critical' },
      { name: 'UTR Number (Corporation Tax)', priority: 'critical' },
      { name: 'VAT Registration Certificate', priority: 'critical' },
      { name: 'Confirmation Statement (CS01)', priority: 'critical' },
      { name: 'Latest Corporation Tax Return (CT600)', priority: 'critical' },
      { name: 'Statutory Accounts (2 years)', priority: 'critical' },
      { name: 'Bank Statements (3 months)', priority: 'critical' },
      { name: 'PAYE Reference Number', priority: 'important' },
      { name: 'P11D Forms (Benefits in Kind)', priority: 'important' },
      { name: 'Directors Loan Account Statements', priority: 'important' },
      { name: 'Memorandum & Articles of Association', priority: 'important' },
      { name: 'VAT Returns (4 quarters)', priority: 'optional' },
      { name: 'Payroll Summary', priority: 'optional' }
    ],
    'LLP': [
      { name: 'LLP Incorporation Certificate', priority: 'critical' },
      { name: 'LLP Agreement', priority: 'critical' },
      { name: 'UTR Number', priority: 'critical' },
      { name: 'VAT Registration', priority: 'critical' },
      { name: 'Annual Accounts (2 years)', priority: 'critical' },
      { name: 'Bank Statements (3 months)', priority: 'critical' },
      { name: 'Members Confirmation Statement', priority: 'important' },
      { name: 'Designated Member Details', priority: 'important' }
    ],
    'Sole Trader': [
      { name: 'UTR Number (Self Assessment)', priority: 'critical' },
      { name: 'National Insurance Number', priority: 'critical' },
      { name: 'Self Assessment Returns (2 years)', priority: 'critical' },
      { name: 'Bank Statements (3 months)', priority: 'critical' },
      { name: 'VAT Registration (if applicable)', priority: 'important' },
      { name: 'Business Address Proof', priority: 'important' }
    ]
  },
  USA: {
    'Corporation (C-Corp)': [
      { name: 'EIN (Employer Identification Number)', priority: 'critical' },
      { name: 'Articles of Incorporation', priority: 'critical' },
      { name: 'Corporate Bylaws', priority: 'critical' },
      { name: 'Federal Tax Returns — Form 1120 (2 years)', priority: 'critical' },
      { name: 'State Tax Returns (2 years)', priority: 'critical' },
      { name: 'Bank Statements (3 months)', priority: 'critical' },
      { name: 'Profit & Loss Statement', priority: 'critical' },
      { name: 'W-9 Form', priority: 'important' },
      { name: '1099 Forms', priority: 'important' },
      { name: 'Payroll Records (Form 941)', priority: 'important' },
      { name: 'State Business License', priority: 'important' },
      { name: 'Business Insurance Certificates', priority: 'optional' },
      { name: 'Franchise Tax Documents', priority: 'optional' }
    ],
    'LLC': [
      { name: 'EIN (Employer Identification Number)', priority: 'critical' },
      { name: 'Articles of Organization', priority: 'critical' },
      { name: 'Operating Agreement', priority: 'critical' },
      { name: 'Federal Tax Returns (2 years)', priority: 'critical' },
      { name: 'Bank Statements (3 months)', priority: 'critical' },
      { name: 'Profit & Loss Statement', priority: 'critical' },
      { name: 'State Business License', priority: 'important' },
      { name: 'Member/Manager Details', priority: 'important' },
      { name: 'W-9 Form', priority: 'important' }
    ],
    'S-Corporation': [
      { name: 'EIN (Employer Identification Number)', priority: 'critical' },
      { name: 'Articles of Incorporation', priority: 'critical' },
      { name: 'IRS S-Corp Election Letter (Form 2553)', priority: 'critical' },
      { name: 'Federal Tax Returns — Form 1120-S (2 years)', priority: 'critical' },
      { name: 'Bank Statements (3 months)', priority: 'critical' },
      { name: 'Shareholder Agreement', priority: 'important' },
      { name: 'K-1 Forms (2 years)', priority: 'important' },
      { name: 'Payroll Records', priority: 'important' }
    ],
    'Sole Proprietorship': [
      { name: 'SSN or EIN', priority: 'critical' },
      { name: 'Federal Tax Returns — Schedule C (2 years)', priority: 'critical' },
      { name: 'Bank Statements (3 months)', priority: 'critical' },
      { name: 'Business License (if applicable)', priority: 'important' },
      { name: 'DBA Certificate (if applicable)', priority: 'optional' }
    ]
  },
  UAE: {
    'LLC': [
      { name: 'Trade License', priority: 'critical' },
      { name: 'Memorandum of Association', priority: 'critical' },
      { name: 'Emirates ID (All Directors)', priority: 'critical' },
      { name: 'Passport Copies (All Directors)', priority: 'critical' },
      { name: 'VAT Registration Certificate (TRN)', priority: 'critical' },
      { name: 'Audited Financial Statements (2 years)', priority: 'critical' },
      { name: 'Bank Statements (6 months)', priority: 'critical' },
      { name: 'Corporate Tax Registration (CT)', priority: 'critical' },
      { name: 'Labour Contract / Immigration Card', priority: 'important' },
      { name: 'Ejari (Tenancy Contract)', priority: 'important' },
      { name: 'Shareholder Certificate', priority: 'important' },
      { name: 'Ultimate Beneficial Owner (UBO) Declaration', priority: 'important' },
      { name: 'ISO Certificates', priority: 'optional' }
    ],
    'Free Zone Company': [
      { name: 'Free Zone Trade License', priority: 'critical' },
      { name: 'Free Zone Certificate of Incorporation', priority: 'critical' },
      { name: 'Emirates ID / Passport (Shareholders)', priority: 'critical' },
      { name: 'Audited Financial Statements (2 years)', priority: 'critical' },
      { name: 'Bank Statements (6 months)', priority: 'critical' },
      { name: 'VAT Registration (TRN)', priority: 'critical' },
      { name: 'Corporate Tax Registration', priority: 'critical' },
      { name: 'Tenancy Contract (Office in Free Zone)', priority: 'important' },
      { name: 'Share Certificate', priority: 'important' }
    ],
    'Branch of Foreign Company': [
      { name: 'Parent Company Trade License', priority: 'critical' },
      { name: 'Branch Registration Certificate (MoE)', priority: 'critical' },
      { name: 'Parent Company Audited Accounts', priority: 'critical' },
      { name: 'Branch Bank Statements (6 months)', priority: 'critical' },
      { name: 'Power of Attorney (Branch Manager)', priority: 'critical' },
      { name: 'No Objection Certificate from Parent', priority: 'important' },
      { name: 'VAT Registration', priority: 'important' }
    ]
  },
  Australia: {
    'Pty Ltd': [
      { name: 'ACN Certificate (ASIC)', priority: 'critical' },
      { name: 'ABN Registration', priority: 'critical' },
      { name: 'ASIC Company Extract', priority: 'critical' },
      { name: 'TFN (Tax File Number)', priority: 'critical' },
      { name: 'GST Registration', priority: 'critical' },
      { name: 'Financial Statements (2 years)', priority: 'critical' },
      { name: 'ATO Portal Access / Tax Returns (2 years)', priority: 'critical' },
      { name: 'Bank Statements (3 months)', priority: 'critical' },
      { name: 'BAS Statements (4 quarters)', priority: 'important' },
      { name: 'PAYG Withholding Registration', priority: 'important' },
      { name: 'Superannuation Fund Details', priority: 'important' },
      { name: 'Director ID', priority: 'important' },
      { name: 'ASIC Annual Review', priority: 'optional' },
      { name: 'Workers Compensation Insurance', priority: 'optional' }
    ],
    'Trust': [
      { name: 'Trust Deed', priority: 'critical' },
      { name: 'ABN Registration', priority: 'critical' },
      { name: 'TFN (Trust)', priority: 'critical' },
      { name: 'Trustee ABN/ACN', priority: 'critical' },
      { name: 'Tax Returns — Trust (2 years)', priority: 'critical' },
      { name: 'Financial Statements (2 years)', priority: 'critical' },
      { name: 'Bank Statements (3 months)', priority: 'critical' },
      { name: 'Trustee Identification', priority: 'important' },
      { name: 'Beneficiary List', priority: 'important' }
    ],
    'Sole Trader': [
      { name: 'ABN Registration', priority: 'critical' },
      { name: 'TFN', priority: 'critical' },
      { name: 'Individual Tax Returns (2 years)', priority: 'critical' },
      { name: 'Bank Statements (3 months)', priority: 'critical' },
      { name: 'BAS Statements (if GST registered)', priority: 'important' },
      { name: 'Business Registration Certificate', priority: 'optional' }
    ]
  },
  Singapore: {
    'Private Limited (Pte. Ltd.)': [
      { name: 'ACRA Business Profile', priority: 'critical' },
      { name: 'UEN (Unique Entity Number)', priority: 'critical' },
      { name: 'GST Registration Certificate (if applicable)', priority: 'critical' },
      { name: 'Audited Financial Statements (2 years)', priority: 'critical' },
      { name: 'Corporate Income Tax Returns (Form C)', priority: 'critical' },
      { name: 'Bank Statements (3 months)', priority: 'critical' },
      { name: 'Director NRIC / Passport', priority: 'critical' },
      { name: 'Shareholder Register', priority: 'important' },
      { name: 'Company Constitution', priority: 'important' },
      { name: 'CPF Contribution Statements', priority: 'important' },
      { name: 'Employment Pass Details (Foreign Directors)', priority: 'optional' }
    ],
    'Sole Proprietorship': [
      { name: 'ACRA Registration', priority: 'critical' },
      { name: 'NRIC / Passport', priority: 'critical' },
      { name: 'Income Tax Returns (2 years)', priority: 'critical' },
      { name: 'Bank Statements (3 months)', priority: 'critical' }
    ]
  }
};

// ─── WhatsApp Templates ────────────────────────────────────────────────────────

const WHATSAPP_TEMPLATES = {
  India: {
    welcome: `Hello {{client_name}} 🙏,\n\nWelcome to our CA firm! We're delighted to begin your onboarding for *{{company}}*.\n\nWe need the following documents to get started:\n• PAN Card & Aadhaar\n• GST Registration Certificate\n• Latest 2 years ITR\n\nPlease upload them at: {{upload_link}}\n\nFor queries, reply to this message.\n\n— Team`,
    reminder: `Dear {{client_name}},\n\nThis is a gentle reminder that we're awaiting the following documents for *{{company}}*:\n\n{{pending_docs}}\n\nKindly submit them by *{{due_date}}* to avoid delays in filing.\n\nUpload link: {{upload_link}}`,
    complete: `✅ Dear {{client_name}},\n\nAll documents for *{{company}}* have been received and verified.\n\nYour onboarding is *complete*! Our team will begin processing within 2 business days.\n\nThank you for your prompt submission. 🙏`
  },
  UK: {
    welcome: `Hello {{client_name}},\n\nWelcome to our accountancy practice! We're pleased to commence onboarding for *{{company}}*.\n\nTo proceed, please provide:\n• Companies House documents\n• UTR Number\n• Last 2 years' statutory accounts\n\nUpload portal: {{upload_link}}\n\nKind regards,\nThe Team`,
    reminder: `Dear {{client_name}},\n\nWe're still awaiting the following documents for *{{company}}*:\n\n{{pending_docs}}\n\nCould you please submit these by *{{due_date}}*?\n\nUpload: {{upload_link}}\n\nThank you`,
    complete: `✅ Dear {{client_name}},\n\nWe've received all required documents for *{{company}}*.\n\nOnboarding is now complete. We'll be in touch within 2 working days to confirm next steps.\n\nBest regards`
  },
  USA: {
    welcome: `Hi {{client_name}},\n\nGreat to have you on board! We're starting the onboarding process for *{{company}}*.\n\nPlease have these ready:\n• EIN Letter\n• Last 2 years' tax returns\n• 3 months bank statements\n\nUpload here: {{upload_link}}\n\nFeel free to reach out anytime!`,
    reminder: `Hi {{client_name}},\n\nQuick reminder — we need the following docs for *{{company}}* to move forward:\n\n{{pending_docs}}\n\nDeadline: *{{due_date}}*\n\nUpload: {{upload_link}}`,
    complete: `✅ Hi {{client_name}},\n\nAll set! We've received everything needed for *{{company}}*.\n\nOur team will reach out within 1-2 business days. Welcome aboard! 🎉`
  },
  UAE: {
    welcome: `مرحبا {{client_name}} / Hello {{client_name}},\n\nWelcome! We're initiating onboarding for *{{company}}*.\n\nRequired documents:\n• Trade License\n• Emirates ID (all partners)\n• VAT Registration (TRN)\n• 6 months bank statements\n\nUpload portal: {{upload_link}}\n\nShukran / Thank you`,
    reminder: `Dear {{client_name}},\n\nKindly note that the following documents are still pending for *{{company}}*:\n\n{{pending_docs}}\n\nPlease submit by *{{due_date}}* to comply with UAE FTA requirements.\n\nUpload: {{upload_link}}`,
    complete: `✅ Dear {{client_name}},\n\nAll documents for *{{company}}* have been received.\n\nOnboarding is complete! We'll send your engagement letter within 48 hours.\n\nThank you 🌟`
  },
  Australia: {
    welcome: `Hi {{client_name}},\n\nWelcome to our accounting practice! Starting onboarding for *{{company}}*.\n\nWe'll need:\n• ACN / ABN Certificate\n• Last 2 years' financial statements\n• BAS Statements (4 quarters)\n\nUpload here: {{upload_link}}\n\nCheers!`,
    reminder: `Hi {{client_name}},\n\nJust a friendly reminder — we're waiting on a few docs for *{{company}}*:\n\n{{pending_docs}}\n\nCould you get these in by *{{due_date}}*?\n\nUpload: {{upload_link}}\n\nThanks heaps!`,
    complete: `✅ G'day {{client_name}},\n\nBeaut news! All documents for *{{company}}* are in and verified.\n\nOnboarding complete — our team will be in touch shortly. Welcome! 🦘`
  },
  Singapore: {
    welcome: `Dear {{client_name}},\n\nWarm greetings! We're commencing onboarding for *{{company}}*.\n\nPlease prepare:\n• ACRA Business Profile\n• Last 2 years' financial statements\n• 3 months bank statements\n\nUpload portal: {{upload_link}}\n\nThank you,\nThe Team`,
    reminder: `Dear {{client_name}},\n\nWe'd like to remind you that the following documents are pending for *{{company}}*:\n\n{{pending_docs}}\n\nKindly submit by *{{due_date}}*.\n\nUpload: {{upload_link}}\n\nThank you`,
    complete: `✅ Dear {{client_name}},\n\nAll documents for *{{company}}* have been received and verified.\n\nYour onboarding is complete. We'll contact you within 2 working days.\n\nWith regards`
  }
};

// ─── Helper: compute checklist + doc completion ───────────────────────────────

function getClientWithStats(client) {
  const docs = db.prepare('SELECT * FROM onboarding_documents WHERE client_id = ?').all(client.id);
  const total = docs.length;
  const received = docs.filter(d => d.received).length;
  const verified = docs.filter(d => d.verified).length;
  const completion = total > 0 ? Math.round((received / total) * 100) : 0;
  const services = (() => { try { return JSON.parse(client.services); } catch { return []; } })();
  return { ...client, services, docs, total_docs: total, received_docs: received, verified_docs: verified, completion_pct: completion };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/onboarding/checklist/:country/:entity
router.get('/checklist/:country/:entity', (req, res) => {
  const { country, entity } = req.params;
  const countryKey = decodeURIComponent(country);
  const entityKey = decodeURIComponent(entity);
  const list = CHECKLISTS[countryKey]?.[entityKey];
  if (!list) {
    return res.status(404).json({ error: `No checklist for ${countryKey} / ${entityKey}` });
  }
  const critical = list.filter(d => d.priority === 'critical');
  const important = list.filter(d => d.priority === 'important');
  const optional = list.filter(d => d.priority === 'optional');
  res.json({ country: countryKey, entity_type: entityKey, critical, important, optional, total: list.length });
});

// GET /api/onboarding/countries
router.get('/countries', (req, res) => {
  const result = {};
  for (const [country, entities] of Object.entries(CHECKLISTS)) {
    result[country] = Object.keys(entities);
  }
  res.json(result);
});

// POST /api/onboarding/client
router.post('/client', (req, res) => {
  const { name, company, country, entity_type, email, whatsapp, financial_year, services } = req.body;
  if (!name || !company || !country || !entity_type || !email) {
    return res.status(400).json({ error: 'name, company, country, entity_type, email are required' });
  }
  const servicesJson = JSON.stringify(Array.isArray(services) ? services : []);
  const insert = db.prepare(`
    INSERT INTO onboarding_clients (name, company, country, entity_type, email, whatsapp, financial_year, services, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'intake')
  `);
  const result = insert.run(name, company, country, entity_type, email, whatsapp || '', financial_year || '', servicesJson);
  const clientId = result.lastInsertRowid;

  // Auto-generate document checklist
  const docs = CHECKLISTS[country]?.[entity_type] || [];
  const insertDoc = db.prepare(`
    INSERT INTO onboarding_documents (client_id, document_name, priority, received, verified)
    VALUES (?, ?, ?, 0, 0)
  `);
  for (const doc of docs) {
    insertDoc.run(clientId, doc.name, doc.priority);
  }

  const client = db.prepare('SELECT * FROM onboarding_clients WHERE id = ?').get(clientId);
  res.status(201).json({ success: true, client_id: clientId, client: getClientWithStats(client) });
});

// GET /api/onboarding/clients
router.get('/clients', (req, res) => {
  const clients = db.prepare('SELECT * FROM onboarding_clients ORDER BY created_at DESC').all();
  const withStats = clients.map(getClientWithStats);
  res.json({ clients: withStats, total: withStats.length });
});

// GET /api/onboarding/client/:id
router.get('/client/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM onboarding_clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const messages = db.prepare('SELECT * FROM onboarding_messages WHERE client_id = ? ORDER BY sent_at DESC').all(client.id);
  const full = { ...getClientWithStats(client), messages };
  res.json(full);
});

// POST /api/onboarding/client/:id/document
router.post('/client/:id/document', (req, res) => {
  const { document_id, received } = req.body;
  if (!document_id) return res.status(400).json({ error: 'document_id is required' });
  const doc = db.prepare('SELECT * FROM onboarding_documents WHERE id = ? AND client_id = ?').get(document_id, req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });

  const isReceived = received !== false;
  db.prepare('UPDATE onboarding_documents SET received = ?, received_at = ? WHERE id = ?')
    .run(isReceived ? 1 : 0, isReceived ? new Date().toISOString() : null, document_id);

  // Recompute completion
  const allDocs = db.prepare('SELECT * FROM onboarding_documents WHERE client_id = ?').all(req.params.id);
  const receivedCount = allDocs.filter(d => d.received).length;
  const pct = allDocs.length > 0 ? Math.round((receivedCount / allDocs.length) * 100) : 0;

  // Auto-update client status based on completion
  let newStatus = 'intake';
  if (pct === 100) newStatus = 'complete';
  else if (pct >= 50) newStatus = 'in_review';
  else if (pct > 0) newStatus = 'documents_pending';
  db.prepare('UPDATE onboarding_clients SET status = ? WHERE id = ?').run(newStatus, req.params.id);

  res.json({ success: true, completion_pct: pct, status: newStatus, document_id, received: isReceived });
});

// POST /api/onboarding/client/:id/upload  (multipart file upload)
router.post('/client/:id/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { document_id } = req.body;
  if (!document_id) return res.status(400).json({ error: 'document_id required' });

  const doc = db.prepare('SELECT * FROM onboarding_documents WHERE id = ? AND client_id = ?').get(document_id, req.params.id);
  const client = db.prepare('SELECT * FROM onboarding_clients WHERE id = ?').get(req.params.id);
  if (!doc || !client) return res.status(404).json({ error: 'Document or client not found' });

  // Mark as received
  db.prepare('UPDATE onboarding_documents SET received = 1, received_at = ? WHERE id = ?')
    .run(new Date().toISOString(), document_id);

  // Recompute completion
  const allDocs = db.prepare('SELECT * FROM onboarding_documents WHERE client_id = ?').all(req.params.id);
  const received = allDocs.filter(d => d.received).length;
  const pct = Math.round((received / allDocs.length) * 100);
  let status = pct === 100 ? 'complete' : pct >= 50 ? 'in_review' : 'documents_pending';
  db.prepare('UPDATE onboarding_clients SET status = ? WHERE id = ?').run(status, req.params.id);

  // Auto-run AI verification for supported file types
  const ext = path.extname(req.file.originalname).toLowerCase();
  const canVerify = ['.pdf', '.jpg', '.jpeg', '.png'].includes(ext);
  let verification = null;

  if (canVerify && process.env.ANTHROPIC_API_KEY) {
    try {
      const fileBuffer = fs.readFileSync(req.file.path);
      const base64 = fileBuffer.toString('base64');
      const mediaType = ext === '.pdf' ? 'application/pdf'
        : ext === '.png' ? 'image/png' : 'image/jpeg';

      const isImage = ['.jpg', '.jpeg', '.png'].includes(ext);
      const contentBlock = isImage
        ? { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }
        : { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64 } };

      const prompt = `You are a CA/CPA verifying a client document.
Client: ${client.country} ${client.entity_type} — ${client.company}
Expected document: ${doc.document_name} (${doc.priority})
Financial year: ${client.financial_year || 'not specified'}

Look at this document and determine:
1. Is it the correct document type?
2. Does it match the country and entity requirements?
3. Is there any red flag (wrong year, unrelated document)?

Respond ONLY with valid JSON: {"verified": true/false, "reason": "brief explanation", "document_type": "what this document is", "confidence": "high/medium/low"}`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 400,
          temperature: 0,
          messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const raw = (data?.content?.[0]?.text || '').trim();
        try {
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          verification = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
        } catch {
          verification = { verified: false, reason: raw, document_type: 'Unknown', confidence: 'low' };
        }
        db.prepare('UPDATE onboarding_documents SET verified = ?, verified_by_ai = 1, ai_reason = ? WHERE id = ?')
          .run(verification.verified ? 1 : 0, verification.reason, document_id);
      }
    } catch (err) {
      console.error('Auto-verify error:', err.message);
    }
  }

  res.json({
    success: true,
    document_id: parseInt(document_id),
    filename: req.file.originalname,
    stored_as: req.file.filename,
    completion_pct: pct,
    status,
    verification
  });
});

// POST /api/onboarding/client/:id/verify  (filename-only, no file)
router.post('/client/:id/verify', async (req, res) => {
  const { document_id, filename, content_description } = req.body;
  if (!document_id || !filename) return res.status(400).json({ error: 'document_id and filename are required' });

  const doc = db.prepare('SELECT * FROM onboarding_documents WHERE id = ? AND client_id = ?').get(document_id, req.params.id);
  const client = db.prepare('SELECT * FROM onboarding_clients WHERE id = ?').get(req.params.id);
  if (!doc || !client) return res.status(404).json({ error: 'Document or client not found' });

  const prompt = `You are a CA/CPA verifying client onboarding documents.

Client Details:
- Country: ${client.country}
- Entity Type: ${client.entity_type}
- Financial Year: ${client.financial_year || 'Not specified'}
- Company: ${client.company}

Document Uploaded:
- Filename: ${filename}
- Expected Document: ${doc.document_name}
- Priority: ${doc.priority}
${content_description ? `- Content Description: ${content_description}` : ''}

Assess whether:
1. The filename suggests it is the correct document type
2. The document matches the client's country and entity type requirements
3. Any red flags (wrong year, wrong format, suspicious filename)

Respond ONLY with valid JSON in this exact format:
{"verified": true/false, "reason": "brief explanation", "document_type": "what this document appears to be", "confidence": "high/medium/low"}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: 'Claude API error', detail: err });
    }

    const data = await response.json();
    const raw = (data?.content?.[0]?.text || '').trim();

    let aiResult;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      aiResult = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      aiResult = { verified: false, reason: raw, document_type: 'Unknown', confidence: 'low' };
    }

    // Persist verification result
    db.prepare(`
      UPDATE onboarding_documents
      SET verified = ?, verified_by_ai = 1, ai_reason = ?
      WHERE id = ?
    `).run(aiResult.verified ? 1 : 0, aiResult.reason, document_id);

    res.json({ success: true, document_id, ...aiResult });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ error: 'Verification failed', detail: error.message });
  }
});

// POST /api/onboarding/client/:id/whatsapp
router.post('/client/:id/whatsapp', async (req, res) => {
  const { template_type = 'welcome', custom_message } = req.body;
  const client = db.prepare('SELECT * FROM onboarding_clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!client.whatsapp) return res.status(400).json({ error: 'Client has no WhatsApp number' });

  const template = WHATSAPP_TEMPLATES[client.country]?.[template_type]
    || WHATSAPP_TEMPLATES['India'][template_type];

  // Build pending docs list for reminder template
  const pendingDocs = db.prepare(
    "SELECT document_name FROM onboarding_documents WHERE client_id = ? AND received = 0 AND priority = 'critical'"
  ).all(client.id).map((d, i) => `${i + 1}. ${d.document_name}`).join('\n');

  const message = (custom_message || template)
    .replace(/\{\{client_name\}\}/g, client.name)
    .replace(/\{\{company\}\}/g, client.company)
    .replace(/\{\{pending_docs\}\}/g, pendingDocs || 'All critical documents')
    .replace(/\{\{due_date\}\}/g, new Date(Date.now() + 5 * 86400000).toLocaleDateString('en-GB'))
    .replace(/\{\{upload_link\}\}/g, `${process.env.APP_URL || 'http://localhost:3000'}/client-upload.html?id=${client.id}`);

  // Log the message
  const insertMsg = db.prepare(`
    INSERT INTO onboarding_messages (client_id, type, template, sent_at, delivered)
    VALUES (?, ?, ?, ?, 0)
  `);
  const msgResult = insertMsg.run(client.id, template_type, message, new Date().toISOString());

  // Send via WATI if configured
  if (process.env.WATI_API_KEY && process.env.WATI_BASE_URL) {
    try {
      const watiResponse = await fetch(`${process.env.WATI_BASE_URL}/api/v1/sendSessionMessage/${client.whatsapp}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.WATI_API_KEY}`
        },
        body: JSON.stringify({ messageText: message })
      });
      if (watiResponse.ok) {
        db.prepare('UPDATE onboarding_messages SET delivered = 1 WHERE id = ?').run(msgResult.lastInsertRowid);
      }
    } catch (watiErr) {
      console.error('WATI send error:', watiErr.message);
    }
  }

  res.json({
    success: true,
    message_id: msgResult.lastInsertRowid,
    whatsapp: client.whatsapp,
    message_preview: message.slice(0, 120) + '...',
    wati_configured: !!(process.env.WATI_API_KEY && process.env.WATI_BASE_URL)
  });
});

// GET /api/onboarding/client/:id/status
router.get('/client/:id/status', (req, res) => {
  const client = db.prepare('SELECT * FROM onboarding_clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const docs = db.prepare('SELECT * FROM onboarding_documents WHERE client_id = ?').all(client.id);
  const messages = db.prepare('SELECT * FROM onboarding_messages WHERE client_id = ? ORDER BY sent_at ASC').all(client.id);

  const critical = docs.filter(d => d.priority === 'critical');
  const criticalDone = critical.filter(d => d.received).length;

  const timeline = [
    { step: 'Client Registered', done: true, date: client.created_at, icon: '✅' },
    { step: 'Welcome Message Sent', done: messages.some(m => m.type === 'welcome'), date: messages.find(m => m.type === 'welcome')?.sent_at || null, icon: '📱' },
    { step: 'Documents Requested', done: docs.length > 0, date: client.created_at, icon: '📋' },
    { step: `Critical Docs Received (${criticalDone}/${critical.length})`, done: criticalDone === critical.length && critical.length > 0, date: docs.filter(d => d.priority === 'critical' && d.received_at).pop()?.received_at || null, icon: '📂' },
    { step: 'All Documents Verified', done: docs.length > 0 && docs.every(d => !d.received || d.verified), date: null, icon: '🔍' },
    { step: 'Onboarding Complete', done: client.status === 'complete', date: null, icon: '🎉' }
  ];

  res.json({
    client_id: client.id,
    company: client.company,
    status: client.status,
    completion_pct: docs.length > 0 ? Math.round((docs.filter(d => d.received).length / docs.length) * 100) : 0,
    timeline,
    docs_summary: {
      total: docs.length,
      received: docs.filter(d => d.received).length,
      verified: docs.filter(d => d.verified).length,
      critical_pending: critical.filter(d => !d.received).map(d => d.document_name)
    },
    messages_sent: messages.length
  });
});

module.exports = router;
module.exports.CHECKLISTS = CHECKLISTS;
module.exports.WHATSAPP_TEMPLATES = WHATSAPP_TEMPLATES;
