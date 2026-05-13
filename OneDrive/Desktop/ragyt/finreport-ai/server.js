const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.use('/api/onboarding', require('./routes/onboarding'));
app.use('/api/accounting', require('./routes/accounting'));

const SYSTEM_PROMPT = `You are a senior IFRS financial reporting expert at a Big 4 
accounting firm with 20 years of experience.

Generate professional, audit-ready IFRS disclosure notes 
based on the financial data provided.

STRICT RULES:
- Follow IFRS 15, IFRS 16, IFRS 9, IAS 1, IAS 8 precisely
- Use formal language suitable for published annual reports
- Write in clear paragraphs with proper headings
- Do NOT invent or fabricate any numbers not provided
- Be globally applicable — not country-specific
- If a field is missing, generate a compliant template note
- Big 4 Premium tone = more detailed technical language

OUTPUT FORMAT — generate exactly these 5 sections:

NOTE 1 — REVENUE RECOGNITION (IFRS 15)
Describe: nature of revenue streams, performance obligations 
identified, timing of recognition (point in time vs over time), 
variable consideration, significant judgments made.

NOTE 2 — LEASE ACCOUNTING (IFRS 16)
Describe: recognition of right-of-use assets and lease 
liabilities, measurement basis, depreciation policy, 
interest treatment, short-term and low-value lease exemptions.
Skip if no lease data provided.

NOTE 3 — FINANCIAL INSTRUMENTS (IFRS 9)
Describe: classification categories used (Amortized Cost, 
FVOCI, FVTPL), ECL (Expected Credit Loss) approach and staging, 
credit risk management, liquidity risk, market risk overview.

NOTE 4 — KEY ACCOUNTING POLICIES (IAS 1)
Describe: basis of preparation (IFRS, going concern), 
measurement basis (historical cost / fair value), 
functional and presentation currency, comparative information.

NOTE 5 — CRITICAL JUDGMENTS & ESTIMATES (IAS 8)
Describe: areas requiring management judgment, key sources 
of estimation uncertainty, impairment assessment approach, 
sensitivity of estimates to change.

Tone: Professional. Annual report quality. CFO and auditor ready.`;

app.post('/api/generate-ifrs', async (req, res) => {
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
        max_tokens: 4000,
        temperature: 0.3,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: req.body.financialData || '' }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    const resultText = (data?.output?.text || data?.completion || data?.content?.[0]?.text || '').trim();

    return res.json({ result: resultText });
  } catch (error) {
    console.error('IFRS API error', error);
    return res.status(500).json({ error: 'Failed to generate IFRS content' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`FinReport AI running on http://localhost:${port}`));
