# 🚀 Supabase Integration Setup Guide

## 📋 Prerequisites

1. Create a Supabase account at [supabase.com](https://supabase.com)
2. Create a new Supabase project
3. Wait for the project to finish initializing

## 🔑 Step 1: Get Supabase Credentials

1. Go to your Supabase project dashboard
2. Click on **Settings** (gear icon in sidebar)
3. Click on **API** in the settings menu
4. You'll find:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon/public key**: `eyJhbGci...` (long JWT token)
   - **service_role key**: `eyJhbGci...` (another long JWT token - keep this secret!)

## 📊 Step 2: Create Database Table

In your Supabase project, go to **SQL Editor** and run this SQL:

```sql
-- Create user_profiles table
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    company TEXT,
    role TEXT DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Create policies for user_profiles
CREATE POLICY "Users can view their own profile"
    ON public.user_profiles
    FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
    ON public.user_profiles
    FOR UPDATE
    USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
    ON public.user_profiles
    FOR INSERT
    WITH CHECK (auth.uid() = id);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

## ⚙️ Step 3: Configure Backend Environment Variables

Update your `backend/.env` file:

```env
# AWS Credentials (existing)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-aws-access-key-here
AWS_SECRET_ACCESS_KEY=your-aws-secret-key-here

# Supabase (NEW - add these)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-supabase-anon-key
SUPABASE_SERVICE_KEY=your-supabase-service-key

# Security (existing)
SECRET_KEY=your-secret-key-here

# App (existing)
DEBUG=True
```

## 🎨 Step 4: Configure Frontend Environment Variables

Create a `frontend/.env` file:

```env
VITE_API_URL=http://localhost:8000
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

⚠️ **Important**: Only use the `anon key` in frontend, NEVER the `service_role key`!

## 🔄 Step 5: Restart Servers

1. Stop both frontend and backend servers (Ctrl+C in their terminals)
2. Start backend:
   ```bash
   cd backend
   python -m uvicorn app.main:app --reload --port 8000
   ```
3. Start frontend:
   ```bash
   cd frontend
   npm run dev
   ```

## ✅ Step 6: Test Authentication

1. Open http://localhost:3000/register
2. Create a new account
3. You should be automatically logged in
4. Check your Supabase dashboard:
   - Go to **Authentication** > **Users** - you should see your new user
   - Go to **Table Editor** > **user_profiles** - you should see the profile data

## 🎯 Benefits of Supabase Integration

✅ **Persistent Database** - No more data loss on restart!
✅ **Real Auth System** - Secure JWT tokens with automatic refresh
✅ **Email Verification** - Built-in email verification (can be enabled)
✅ **Password Reset** - Built-in password reset flows
✅ **Social Auth** - Can add Google, GitHub, etc. login later
✅ **Real-time** - Can add real-time features later
✅ **File Storage** - Can store documents and files
✅ **Row Level Security** - Built-in security policies

## 🆘 Troubleshooting

### Error: "Supabase environment variables are not set"
- Make sure you created the `.env` files
- Make sure the variable names match exactly
- Restart the servers after adding environment variables

### Error: "relation 'user_profiles' does not exist"
- Run the SQL from Step 2 in your Supabase SQL Editor
- Make sure the table was created successfully

### Error: "Invalid API key"
- Double-check you copied the correct keys from Supabase
- Make sure there are no extra spaces in the `.env` file
- Use the `anon key` in frontend, not the `service_role key`

### Login issues
- Clear browser localStorage
- Make sure email confirmation is disabled in Supabase Auth settings:
  - Go to **Authentication** > **Settings**
  - Disable "Enable email confirmations"

## 📚 Next Steps

Once Supabase is working, you can:
- Add password reset functionality
- Add social authentication (Google, GitHub, etc.)
- Add email verification
- Add real-time features
- Store uploaded files in Supabase Storage
- Add more tables for journal entries, analytics, etc.

---

**Need help?** Check the [Supabase Documentation](https://supabase.com/docs)
