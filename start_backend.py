"""Helper script to start the backend from the correct directory."""
import os
import sys
import subprocess

backend_dir = r"C:\Users\HCSUSER\OneDrive\Desktop\CFO\backend"
os.chdir(backend_dir)
sys.path.insert(0, backend_dir)

print(f"Starting backend from: {os.getcwd()}")

subprocess.run([
    sys.executable, "-m", "uvicorn", "app.main:app",
    "--port", "8000",
    "--log-level", "info",
])
