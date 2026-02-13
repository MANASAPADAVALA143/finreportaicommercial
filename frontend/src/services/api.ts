import axios, { AxiosInstance, AxiosError } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const API_VERSION = '/api/v1';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: `${API_BASE_URL}${API_VERSION}`,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor to add auth token
    this.client.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('access_token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 401) {
          // Handle unauthorized - redirect to login
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  // Auth endpoints
  async register(email: string, password: string, fullName?: string, company?: string) {
    const response = await this.client.post('/auth/register', {
      email,
      password,
      full_name: fullName,
      company,
    });
    return response.data;
  }

  async login(email: string, password: string) {
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
  async createJournalEntry(data: any) {
    const response = await this.client.post('/journal-entries/', data);
    return response.data;
  }

  async getJournalEntries(params?: any) {
    const response = await this.client.get('/journal-entries/', { params });
    return response.data;
  }

  async getJournalEntry(id: number) {
    const response = await this.client.get(`/journal-entries/${id}`);
    return response.data;
  }

  async approveJournalEntry(id: number) {
    const response = await this.client.put(`/journal-entries/${id}/approve`);
    return response.data;
  }

  async deleteJournalEntry(id: number) {
    const response = await this.client.delete(`/journal-entries/${id}`);
    return response.data;
  }

  // Analytics
  async getDashboardAnalytics() {
    const response = await this.client.get('/analytics/dashboard');
    return response.data;
  }

  async getTrends(days: number = 30) {
    const response = await this.client.get('/analytics/trends', { params: { days } });
    return response.data;
  }

  async getFinancialRatios() {
    const response = await this.client.get('/analytics/financial-ratios');
    return response.data;
  }

  async getAnomalies(limit: number = 50) {
    const response = await this.client.get('/analytics/anomalies', { params: { limit } });
    return response.data;
  }

  // Nova AI
  async analyzeWithNova(prompt: string, context?: any) {
    const response = await this.client.post('/nova/analyze', {
      prompt,
      context,
    });
    return response.data;
  }

  async analyzeJournalEntryWithNova(entryData: any) {
    const response = await this.client.post('/nova/analyze-entry', entryData);
    return response.data;
  }

  async generateForecast(historicalData: any, period: string = 'next_quarter') {
    const response = await this.client.post('/nova/forecast', historicalData, {
      params: { period },
    });
    return response.data;
  }

  async checkCompliance(financialData: any, standard: string = 'IFRS') {
    const response = await this.client.post('/nova/compliance-check', financialData, {
      params: { standard },
    });
    return response.data;
  }
}

export const api = new ApiClient();
export default api;
