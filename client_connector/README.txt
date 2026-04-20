FinReportAI Tally Connector
============================

WHAT THIS DOES:
Automatically exports your Trial Balance from Tally
every night and sends it to FinReportAI.
Your IFRS Financial Statements are updated automatically.
You do nothing after setup.

REQUIREMENTS:
- Tally Prime or Tally ERP 9 must be running
- Tally port 9000 must be enabled
- Internet connection

ENABLE TALLY PORT:
In Tally: F12 -> Advanced Configuration
  Enable ODBC Server: Yes
  Port Number: 9000

INSTALL:
1. Double-click install.bat (Run as Administrator recommended for Task Scheduler)
2. Follow the setup wizard
3. Done — syncs every night at 12:30 AM if you create the scheduled task

CHECK LOGS:
Open tally_connector.log in this folder to see sync history

API KEY (server-side):
The backend stores SHA-256(api_key) in table connector_clients for your entity_id.
Generate digest:  python -c "import hashlib; print(hashlib.sha256(b'YOUR_KEY').hexdigest())"
Dev bypass (optional): set env TALLY_CONNECTOR_BYPASS_KEY to the plaintext key
  and TALLY_CONNECTOR_BYPASS_TENANT to your tenant id (see backend/env.example).

SUPPORT:
Email: support@finreportai.com
