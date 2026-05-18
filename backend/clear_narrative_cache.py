import sqlite3
conn = sqlite3.connect(r"C:\Users\HCSUSER\OneDrive\Desktop\CFO\backend\finreportai.db")
cur = conn.execute("DELETE FROM je_narratives")
conn.commit()
print(f"Cleared {cur.rowcount} cached narratives from je_narratives table.")
conn.close()
