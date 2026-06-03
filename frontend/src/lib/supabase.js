import { createClient } from '@supabase/supabase-js';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key';
// Check if Supabase is properly configured
export const isSupabaseConfigured = !!(import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_ANON_KEY);
if (!isSupabaseConfigured) {
    console.warn('⚠️ Supabase not configured. Please create frontend/.env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
}
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
    },
});
