/**
 * Authentication service — thin wrapper around Supabase Auth.
 * Used by LoginPage, SignupPage, AuthGuard, and Layout logout.
 */
import { supabase } from '@/lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

export type AuthUser = User;
export type AuthSession = Session;

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUpWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<AuthSession | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getUser(): Promise<AuthUser | null> {
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

/** Subscribe to auth state changes. Returns unsubscribe fn. */
export function onAuthStateChange(callback: (session: AuthSession | null) => void) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}
