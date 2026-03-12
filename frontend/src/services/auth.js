import { create } from 'zustand';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
// DEMO MODE - Mock users for testing without Supabase
const DEMO_MODE = !isSupabaseConfigured;
const mockUsers = new Map();
export const useAuthStore = create((set) => ({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    login: async (email, password) => {
        set({ isLoading: true, error: null });
        // DEMO MODE - Use mock authentication
        if (DEMO_MODE) {
            try {
                await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
                const mockUser = mockUsers.get(email);
                if (!mockUser || mockUser.password !== password) {
                    throw new Error('Invalid email or password');
                }
                localStorage.setItem('access_token', 'demo-token-' + Date.now());
                localStorage.setItem('demo_user', JSON.stringify(mockUser.user));
                set({ user: mockUser.user, isAuthenticated: true, isLoading: false });
                return;
            }
            catch (error) {
                set({
                    error: error.message || 'Login failed',
                    isLoading: false
                });
                throw error;
            }
        }
        // PRODUCTION MODE - Use Supabase
        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });
            if (error)
                throw error;
            if (data.session) {
                localStorage.setItem('access_token', data.session.access_token);
                localStorage.setItem('refresh_token', data.session.refresh_token);
                // Get user profile from Supabase
                const { data: profileData } = await supabase
                    .from('user_profiles')
                    .select('*')
                    .eq('id', data.user.id)
                    .single();
                const user = {
                    id: data.user.id,
                    email: data.user.email,
                    full_name: profileData?.full_name,
                    company: profileData?.company,
                    role: profileData?.role || 'user',
                };
                set({ user, isAuthenticated: true, isLoading: false });
            }
        }
        catch (error) {
            set({
                error: error.message || 'Login failed',
                isLoading: false
            });
            throw error;
        }
    },
    register: async (email, password, fullName, company) => {
        set({ isLoading: true, error: null });
        // DEMO MODE - Use mock authentication
        if (DEMO_MODE) {
            try {
                await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
                if (mockUsers.has(email)) {
                    throw new Error('Email already registered');
                }
                const user = {
                    id: 'demo-' + Date.now(),
                    email,
                    full_name: fullName,
                    company,
                    role: 'user',
                };
                mockUsers.set(email, { password, user });
                localStorage.setItem('access_token', 'demo-token-' + Date.now());
                localStorage.setItem('demo_user', JSON.stringify(user));
                set({ user, isAuthenticated: true, isLoading: false });
                return;
            }
            catch (error) {
                set({
                    error: error.message || 'Registration failed',
                    isLoading: false
                });
                throw error;
            }
        }
        // PRODUCTION MODE - Use Supabase
        try {
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        full_name: fullName,
                        company: company,
                        role: 'user',
                    },
                },
            });
            if (error)
                throw error;
            if (data.session) {
                localStorage.setItem('access_token', data.session.access_token);
                localStorage.setItem('refresh_token', data.session.refresh_token);
                // Create user profile in Supabase
                await supabase
                    .from('user_profiles')
                    .upsert({
                    id: data.user.id,
                    email,
                    full_name: fullName,
                    company,
                    role: 'user',
                });
                const user = {
                    id: data.user.id,
                    email: data.user.email,
                    full_name: fullName,
                    company,
                    role: 'user',
                };
                set({ user, isAuthenticated: true, isLoading: false });
            }
        }
        catch (error) {
            set({
                error: error.message || 'Registration failed',
                isLoading: false
            });
            throw error;
        }
    },
    logout: async () => {
        try {
            if (!DEMO_MODE) {
                await supabase.auth.signOut();
            }
            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('demo_user');
        }
        catch (error) {
            console.error('Logout error:', error);
        }
        finally {
            set({ user: null, isAuthenticated: false });
        }
    },
    checkAuth: async () => {
        set({ isLoading: true });
        // DEMO MODE - Check localStorage
        if (DEMO_MODE) {
            try {
                const token = localStorage.getItem('access_token');
                const demoUserStr = localStorage.getItem('demo_user');
                if (token && demoUserStr) {
                    const user = JSON.parse(demoUserStr);
                    set({ user, isAuthenticated: true, isLoading: false });
                }
                else {
                    set({ isAuthenticated: false, user: null, isLoading: false });
                }
            }
            catch (error) {
                set({ isAuthenticated: false, user: null, isLoading: false });
            }
            return;
        }
        // PRODUCTION MODE - Check Supabase session
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                set({ isAuthenticated: false, user: null, isLoading: false });
                return;
            }
            localStorage.setItem('access_token', session.access_token);
            localStorage.setItem('refresh_token', session.refresh_token);
            // Get user profile
            const { data: profileData } = await supabase
                .from('user_profiles')
                .select('*')
                .eq('id', session.user.id)
                .single();
            const user = {
                id: session.user.id,
                email: session.user.email,
                full_name: profileData?.full_name,
                company: profileData?.company,
                role: profileData?.role || 'user',
            };
            set({ user, isAuthenticated: true, isLoading: false });
        }
        catch (error) {
            set({ isAuthenticated: false, user: null, isLoading: false });
        }
    },
    clearError: () => set({ error: null }),
}));
