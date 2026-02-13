#!/usr/bin/env python3
"""
Direct user creation script - bypasses email confirmation
"""
from supabase import create_client
import os

# Your Supabase credentials
SUPABASE_URL = "https://nmtkfvyzmpqpsiizbfqy.supabase.co"
SUPABASE_SERVICE_KEY = "YOUR_SERVICE_ROLE_KEY_HERE"  # Get from Supabase Settings > API

# User details
EMAIL = "manusmile0587@gmail.com"
PASSWORD = "YourPassword123"  # Change this to your desired password
FULL_NAME = "MANASA padavala"
COMPANY = "GNANOVAPRO"

try:
    # Create Supabase client with service key (bypasses rate limits)
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    # Create user with admin privileges
    response = supabase.auth.admin.create_user({
        "email": EMAIL,
        "password": PASSWORD,
        "email_confirm": True,  # Auto-confirm email
        "user_metadata": {
            "full_name": FULL_NAME,
            "company": COMPANY,
            "role": "user"
        }
    })
    
    print(f"✅ User created successfully!")
    print(f"📧 Email: {EMAIL}")
    print(f"🔑 Password: {PASSWORD}")
    print(f"\n🎉 You can now login at http://localhost:3000/login")
    
except Exception as e:
    print(f"❌ Error: {str(e)}")
    print("\nPlease disable email confirmation in Supabase dashboard instead:")
    print("Authentication > Providers > Email > Uncheck 'Confirm email'")
