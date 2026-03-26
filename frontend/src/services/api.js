import axios from 'axios';
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const API_VERSION = '/api/v1';
class ApiClient {
    constructor() {
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.client = axios.create({
            baseURL: `${API_BASE_URL}${API_VERSION}`,
            headers: {
                'Content-Type': 'application/json',
            },
        });
        // Request interceptor to add auth token
        this.client.interceptors.request.use((config) => {
            const token = localStorage.getItem('access_token');
            if (token) {
                config.headers.Authorization = `Bearer ${token}`;
            }
            return config;
        }, (error) => Promise.reject(error));
        // Response interceptor for error handling
        this.client.interceptors.response.use((response) => response, async (error) => {
            if (error.response?.status === 401) {
                // Handle unauthorized - redirect to login
                localStorage.removeItem('access_token');
                localStorage.removeItem('refresh_token');
                window.location.href = '/login';
            }
            return Promise.reject(error);
        });
    }
    // Auth endpoints
    async register(email, password, fullName, company) {
        const response = await this.client.post('/auth/register', {
            email,
            password,
            full_name: fullName,
            company,
        });
        return response.data;
    }
    async login(email, password) {
        const response = await this.client.post('/auth/login', { email, password });
        const { access_token, refresh_token } = response.data;
        localStorage.setItem('access_token', access_token);
        localStorage.setItem('refresh_token', refresh_token);
        return response.data;
    }
    async logout() {
        await this.client.post('/auth/logout');
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
    }
    async getCurrentUser() {
        const response = await this.client.get('/auth/me');
        return response.data;
    }
    // Journal Entries
    async createJournalEntry(data) {
        const response = await this.client.post('/journal-entries/', data);
        return response.data;
    }
    async getJournalEntries(params) {
        const response = await this.client.get('/journal-entries/', { params });
        return response.data;
    }
    async getJournalEntry(id) {
        const response = await this.client.get(`/journal-entries/${id}`);
        return response.data;
    }
    async approveJournalEntry(id) {
        const response = await this.client.put(`/journal-entries/${id}/approve`);
        return response.data;
    }
    async deleteJournalEntry(id) {
        const response = await this.client.delete(`/journal-entries/${id}`);
        return response.data;
    }
    // Analytics
    async getDashboardAnalytics() {
        const response = await this.client.get('/analytics/dashboard');
        return response.data;
    }
    async getTrends(days = 30) {
        const response = await this.client.get('/analytics/trends', { params: { days } });
        return response.data;
    }
    async getFinancialRatios() {
        const response = await this.client.get('/analytics/financial-ratios');
        return response.data;
    }
    async getAnomalies(limit = 50) {
        const response = await this.client.get('/analytics/anomalies', { params: { limit } });
        return response.data;
    }
    /** CFO assistant chat — uses /api/ai (not /api/v1). Requires Bearer token if backend enforces auth. */
    async analyzeWithAI(prompt, context) {
        const token = localStorage.getItem('access_token');
        const response = await axios.post(`${API_BASE_URL}/api/ai/analyze`, { prompt, context, max_tokens: 2000, temperature: 0.3 }, {
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
        });
        return response.data;
    }
    /** @deprecated use analyzeWithAI */
    async analyzeWithNova(prompt, context) {
        return this.analyzeWithAI(prompt, context);
    }
    async analyzeJournalEntryWithAI(entryData) {
        const token = localStorage.getItem('access_token');
        const response = await axios.post(`${API_BASE_URL}/api/ai/analyze-entry`, entryData, {
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
        });
        return response.data;
    }
    async generateForecast(historicalData, period = 'next_quarter') {
        const token = localStorage.getItem('access_token');
        const response = await axios.post(`${API_BASE_URL}/api/ai/forecast`, historicalData, {
            params: { period },
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
        });
        return response.data;
    }
    async checkCompliance(financialData, standard = 'IFRS') {
        const token = localStorage.getItem('access_token');
        const response = await axios.post(`${API_BASE_URL}/api/ai/compliance-check`, financialData, {
            params: { standard },
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
        });
        return response.data;
    }
}
export const api = new ApiClient();
export default api;
