CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name VARCHAR(50) NOT NULL,
  run_time TIMESTAMP DEFAULT NOW(),
  input_data JSONB,
  output_data JSONB,
  insight JSONB,
  urgency VARCHAR(10) DEFAULT 'green',
  acknowledged BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_memory (
  agent_name VARCHAR(50) PRIMARY KEY,
  last_6_months JSONB DEFAULT '[]',
  patterns JSONB DEFAULT '{}',
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forecast_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_date DATE DEFAULT CURRENT_DATE,
  conservative NUMERIC,
  base_case NUMERIC,
  optimistic NUMERIC,
  confidence_score INTEGER,
  key_assumptions JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS board_packs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  month INTEGER,
  year INTEGER,
  pdf_path VARCHAR(500),
  generated_at TIMESTAMP DEFAULT NOW(),
  sent_to_cfo BOOLEAN DEFAULT FALSE,
  content JSONB
);

CREATE TABLE IF NOT EXISTS cfo_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_type VARCHAR(10),
  title VARCHAR(200),
  what_happened TEXT,
  why_it_happened TEXT,
  what_to_do TEXT,
  board_line TEXT,
  confidence INTEGER,
  sent_whatsapp BOOLEAN DEFAULT FALSE,
  sent_email BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
