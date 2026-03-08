import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Send,
  Sparkles,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle,
  Bell,
  Activity,
  MessageSquare,
  Upload
} from 'lucide-react';
import { CFOTab, ChatMessage, StrategicInsight, KPIAlert } from '../../types/cfo';
import {
  initialChatMessages,
  suggestedQuestions,
  mockInsights,
  mockKPIAlerts,
  mockHealthScore,
  financialContext
} from '../../data/cfoMockData';
import { callAI } from '../../services/aiProvider';

interface CFOServicesProps {
  defaultTab?: CFOTab;
}

const CFOServices: React.FC<CFOServicesProps> = ({ defaultTab = 'assistant' }) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<CFOTab>(defaultTab);
  const [messages, setMessages] = useState<ChatMessage[]>(initialChatMessages);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [insights, setInsights] = useState<StrategicInsight[]>(mockInsights);
  const [alerts, setAlerts] = useState<KPIAlert[]>(mockKPIAlerts);
  const [healthScore] = useState(mockHealthScore);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim() || isLoading) return;

    const newUserMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, newUserMsg]);
    setInputMessage('');
    setIsLoading(true);

    const loadingMsg: ChatMessage = {
      id: 'loading',
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isLoading: true,
    };
    setMessages(prev => [...prev, loadingMsg]);

    try {
      const prompt = `You are a CFO AI Assistant with deep financial expertise.
Answer the CFO's question based on the financial data provided.
Be specific with numbers. Use ₹ for amounts.
Format with bullet points for lists.
Keep response under 200 words unless detailed analysis is requested.
End with 1 recommended action if relevant.

${financialContext}

USER QUESTION: ${userMessage}`;

      const response = await callAI(prompt);

      setMessages(prev => prev.map(m =>
        m.id === 'loading'
          ? {
              ...m,
              id: Date.now().toString(),
              content: response,
              isLoading: false,
              sources: ['Variance Analysis', 'KPI Dashboard', 'Cash Flow']
            }
          : m
      ));
    } catch (error: any) {
      setMessages(prev => prev.map(m =>
        m.id === 'loading'
          ? {
              ...m,
              id: Date.now().toString(),
              content: `❌ Sorry, I encountered an error: ${error.message}. Please try again.`,
              isLoading: false
            }
          : m
      ));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestedQuestion = (question: string) => {
    setInputMessage(question);
    inputRef.current?.focus();
  };

  const dismissAlert = (id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  const getHealthColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-blue-600';
    if (score >= 40) return 'text-amber-600';
    return 'text-red-600';
  };

  const getHealthBarColor = (score: number) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-blue-500';
    if (score >= 40) return 'bg-amber-500';
    return 'bg-red-500';
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'revenue': return '💰';
      case 'cost': return '📊';
      case 'cash': return '💵';
      case 'risk': return '⚠️';
      case 'opportunity': return '🚀';
      default: return '💡';
    }
  };

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'immediate': return 'border-red-500 bg-red-50';
      case 'this_week': return 'border-amber-500 bg-amber-50';
      default: return 'border-blue-500 bg-blue-50';
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <span className="px-2 py-1 text-xs font-semibold bg-red-100 text-red-700 rounded-full">🔴 CRITICAL</span>;
      case 'warning':
        return <span className="px-2 py-1 text-xs font-semibold bg-amber-100 text-amber-700 rounded-full">⚠️ WARNING</span>;
      default:
        return <span className="px-2 py-1 text-xs font-semibold bg-blue-100 text-blue-700 rounded-full">ℹ️ INFO</span>;
    }
  };

  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  const warningAlerts = alerts.filter(a => a.severity === 'warning');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 p-6">
      {/* Header */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/dashboard')}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft size={24} className="text-gray-700" />
              </button>
              <div>
                <div className="flex items-center gap-3">
                  <Sparkles size={32} className="text-purple-600" />
                  <div>
                    <h1 className="text-3xl font-bold text-gray-900">🤖 CFO Services</h1>
                    <p className="text-gray-600 mt-1">AI Assistant · Strategic Insights · KPI Monitor</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/upload-data')}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
              >
                <Upload className="w-4 h-4" />
                <span>Upload Data</span>
              </button>
              <div className="text-right">
                <div className="text-sm text-gray-600">Powered by</div>
                <div className="font-semibold text-purple-600">Amazon Nova</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-2 flex gap-2">
          <button
            onClick={() => setActiveTab('assistant')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-colors ${
              activeTab === 'assistant'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
            }`}
          >
            <MessageSquare size={20} />
            AI Assistant
          </button>
          <button
            onClick={() => setActiveTab('insights')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-colors ${
              activeTab === 'insights'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Sparkles size={20} />
            Strategic Insights
            {insights.filter(i => i.urgency === 'immediate').length > 0 && (
              <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                {insights.filter(i => i.urgency === 'immediate').length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('monitor')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-colors ${
              activeTab === 'monitor'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Bell size={20} />
            KPI Monitor
            {criticalAlerts.length > 0 && (
              <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                {criticalAlerts.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('health')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-colors ${
              activeTab === 'health'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Activity size={20} />
            Health Score
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-[1800px] mx-auto">
        {/* TAB 1: AI ASSISTANT */}
        {activeTab === 'assistant' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col" style={{ height: 'calc(100vh - 320px)' }}>
            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.map((message) => (
                <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] ${message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'} rounded-2xl p-4`}>
                    {message.isLoading ? (
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                        </div>
                        <span className="text-sm text-gray-600">Nova is thinking...</span>
                      </div>
                    ) : (
                      <>
                        <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
                        {message.sources && message.role === 'assistant' && (
                          <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">
                            Sources: {message.sources.join(', ')}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Suggested Questions */}
            {messages.length <= 2 && (
              <div className="border-t border-gray-200 p-4 bg-gray-50">
                <div className="text-xs text-gray-600 mb-2">Suggested questions:</div>
                <div className="flex flex-wrap gap-2">
                  {suggestedQuestions.slice(0, 4).map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSuggestedQuestion(q)}
                      className="px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-full hover:bg-gray-100 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input Box */}
            <div className="border-t border-gray-200 p-4">
              <div className="flex gap-3">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage(inputMessage)}
                  placeholder="Type your question here..."
                  disabled={isLoading}
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
                />
                <button
                  onClick={() => sendMessage(inputMessage)}
                  disabled={!inputMessage.trim() || isLoading}
                  className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Send size={20} />
                  Send
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: STRATEGIC INSIGHTS */}
        {activeTab === 'insights' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">💡 Strategic Insights</h2>
                <p className="text-gray-600 mt-1">AI-generated analysis of your financial position · Last updated: Today 8:00 AM</p>
              </div>
              <button className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2">
                <Sparkles size={18} />
                Refresh Insights
              </button>
            </div>

            {/* Immediate Action Required */}
            <div>
              <h3 className="text-lg font-bold text-red-600 mb-3">🔴 IMMEDIATE ACTION REQUIRED</h3>
              <div className="space-y-4">
                {insights.filter(i => i.urgency === 'immediate').map(insight => (
                  <div key={insight.id} className={`border-2 rounded-xl p-6 ${getUrgencyColor(insight.urgency)}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">{getCategoryIcon(insight.category)}</span>
                        <div>
                          <h4 className="font-bold text-gray-900 text-lg">{insight.title}</h4>
                          <p className="text-sm text-gray-700 mt-1">{insight.summary}</p>
                        </div>
                      </div>
                      <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                        insight.impact === 'high' ? 'bg-red-100 text-red-700' :
                        insight.impact === 'medium' ? 'bg-amber-100 text-amber-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        Impact: {insight.impact.toUpperCase()} {insight.impact === 'high' ? '🔴' : insight.impact === 'medium' ? '⚠️' : 'ℹ️'}
                      </span>
                    </div>
                    
                    <p className="text-sm text-gray-700 mb-4">{insight.detail}</p>
                    
                    {insight.metric && (
                      <div className="bg-white bg-opacity-50 rounded-lg p-3 mb-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-600">{insight.metric.label}</span>
                          <div className="text-right">
                            <span className="font-bold text-gray-900">{insight.metric.value}</span>
                            <span className="text-xs text-gray-600 ml-2">{insight.metric.change}</span>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    <div className="bg-white bg-opacity-70 rounded-lg p-3 mb-4">
                      <div className="text-xs font-semibold text-gray-700 mb-1">RECOMMENDED ACTION:</div>
                      <div className="text-sm text-gray-900">{insight.action}</div>
                    </div>

                    <div className="flex gap-2">
                      <button className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
                        Ask AI More
                      </button>
                      <button className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors">
                        Add to Actions
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Review This Week */}
            <div>
              <h3 className="text-lg font-bold text-amber-600 mb-3">⚠️ REVIEW THIS WEEK</h3>
              <div className="space-y-4">
                {insights.filter(i => i.urgency === 'this_week').map(insight => (
                  <div key={insight.id} className={`border-2 rounded-xl p-6 ${getUrgencyColor(insight.urgency)}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">{getCategoryIcon(insight.category)}</span>
                        <div>
                          <h4 className="font-bold text-gray-900 text-lg">{insight.title}</h4>
                          <p className="text-sm text-gray-700 mt-1">{insight.summary}</p>
                        </div>
                      </div>
                      <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                        insight.impact === 'high' ? 'bg-red-100 text-red-700' :
                        insight.impact === 'medium' ? 'bg-amber-100 text-amber-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        Impact: {insight.impact.toUpperCase()} {insight.impact === 'medium' ? '⚠️' : 'ℹ️'}
                      </span>
                    </div>
                    
                    <p className="text-sm text-gray-700 mb-4">{insight.detail}</p>
                    
                    {insight.metric && (
                      <div className="bg-white bg-opacity-50 rounded-lg p-3 mb-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-600">{insight.metric.label}</span>
                          <div className="text-right">
                            <span className="font-bold text-gray-900">{insight.metric.value}</span>
                            <span className="text-xs text-gray-600 ml-2">{insight.metric.change}</span>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    <div className="bg-white bg-opacity-70 rounded-lg p-3 mb-4">
                      <div className="text-xs font-semibold text-gray-700 mb-1">RECOMMENDED ACTION:</div>
                      <div className="text-sm text-gray-900">{insight.action}</div>
                    </div>

                    <div className="flex gap-2">
                      <button className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
                        Ask AI More
                      </button>
                      <button className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors">
                        Add to Actions
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Positive Highlights */}
            <div>
              <h3 className="text-lg font-bold text-green-600 mb-3">✅ POSITIVE HIGHLIGHTS</h3>
              <div className="space-y-4">
                {insights.filter(i => i.urgency === 'this_month').map(insight => (
                  <div key={insight.id} className={`border-2 rounded-xl p-6 ${getUrgencyColor(insight.urgency)}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">{getCategoryIcon(insight.category)}</span>
                        <div>
                          <h4 className="font-bold text-gray-900 text-lg">{insight.title}</h4>
                          <p className="text-sm text-gray-700 mt-1">{insight.summary}</p>
                        </div>
                      </div>
                      <span className="px-3 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-700">
                        Impact: {insight.impact.toUpperCase()} ✅
                      </span>
                    </div>
                    
                    <p className="text-sm text-gray-700 mb-4">{insight.detail}</p>
                    
                    {insight.metric && (
                      <div className="bg-white bg-opacity-50 rounded-lg p-3 mb-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-600">{insight.metric.label}</span>
                          <div className="text-right">
                            <span className="font-bold text-gray-900">{insight.metric.value}</span>
                            <span className="text-xs text-gray-600 ml-2">{insight.metric.change}</span>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {insight.action && (
                      <div className="bg-white bg-opacity-70 rounded-lg p-3">
                        <div className="text-xs font-semibold text-gray-700 mb-1">RECOMMENDED ACTION:</div>
                        <div className="text-sm text-gray-900">{insight.action}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: KPI MONITOR */}
        {activeTab === 'monitor' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">🔔 KPI Monitor</h2>
                <p className="text-gray-600 mt-1">Automated alerts when KPIs breach thresholds · {alerts.length} active alerts</p>
              </div>
              <button className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors">
                Set Thresholds
              </button>
            </div>

            {/* Critical Alerts */}
            {criticalAlerts.length > 0 && (
              <div>
                <h3 className="text-lg font-bold text-red-600 mb-3">🔴 CRITICAL ({criticalAlerts.length})</h3>
                <div className="space-y-4">
                  {criticalAlerts.map(alert => (
                    <div key={alert.id} className="bg-white border-2 border-red-500 rounded-xl p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h4 className="font-bold text-gray-900 text-lg">{alert.kpi}</h4>
                            {getSeverityBadge(alert.severity)}
                          </div>
                          <p className="text-sm text-red-700 font-medium">{alert.message}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4 mb-4 bg-red-50 rounded-lg p-4">
                        <div>
                          <div className="text-xs text-gray-600 mb-1">Current</div>
                          <div className="font-bold text-gray-900">{alert.current}{alert.kpi.includes('%') || alert.kpi.includes('Margin') ? '%' : alert.kpi.includes('days') ? ' days' : ''}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-600 mb-1">Threshold</div>
                          <div className="font-bold text-gray-900">{alert.threshold}{alert.kpi.includes('%') || alert.kpi.includes('Margin') ? '%' : alert.kpi.includes('days') ? ' days' : ''}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-600 mb-1">Gap</div>
                          <div className="font-bold text-red-600">
                            {alert.current > alert.threshold ? '▲' : '▼'} {Math.abs(alert.current - alert.threshold).toFixed(1)}{alert.kpi.includes('%') || alert.kpi.includes('Margin') ? 'pp' : alert.kpi.includes('days') ? ' days' : ''}
                          </div>
                        </div>
                      </div>

                      <div className="bg-gray-50 rounded-lg p-4 mb-4">
                        <div className="text-xs font-semibold text-gray-700 mb-1">Recommendation:</div>
                        <div className="text-sm text-gray-900">{alert.recommendation}</div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">Triggered: {new Date(alert.triggeredAt).toLocaleString()}</span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => dismissAlert(alert.id)}
                            className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                          >
                            Dismiss
                          </button>
                          <button className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
                            Investigate
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Warning Alerts */}
            {warningAlerts.length > 0 && (
              <div>
                <h3 className="text-lg font-bold text-amber-600 mb-3">⚠️ WARNING ({warningAlerts.length})</h3>
                <div className="space-y-4">
                  {warningAlerts.map(alert => (
                    <div key={alert.id} className="bg-white border-2 border-amber-500 rounded-xl p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h4 className="font-bold text-gray-900 text-lg">{alert.kpi}</h4>
                            {getSeverityBadge(alert.severity)}
                          </div>
                          <p className="text-sm text-amber-700 font-medium">{alert.message}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4 mb-4 bg-amber-50 rounded-lg p-4">
                        <div>
                          <div className="text-xs text-gray-600 mb-1">Current</div>
                          <div className="font-bold text-gray-900">{alert.current}{alert.kpi.includes('%') || alert.kpi.includes('Margin') ? '%' : alert.kpi.includes('days') ? ' days' : ''}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-600 mb-1">Threshold</div>
                          <div className="font-bold text-gray-900">{alert.threshold}{alert.kpi.includes('%') || alert.kpi.includes('Margin') ? '%' : alert.kpi.includes('days') ? ' days' : ''}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-600 mb-1">Gap</div>
                          <div className="font-bold text-amber-600">
                            {alert.current > alert.threshold ? '▲' : '▼'} {Math.abs(alert.current - alert.threshold).toFixed(1)}{alert.kpi.includes('%') || alert.kpi.includes('Margin') ? 'pp' : ''}
                          </div>
                        </div>
                      </div>

                      <div className="bg-gray-50 rounded-lg p-4 mb-4">
                        <div className="text-xs font-semibold text-gray-700 mb-1">Recommendation:</div>
                        <div className="text-sm text-gray-900">{alert.recommendation}</div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">Triggered: {new Date(alert.triggeredAt).toLocaleString()}</span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => dismissAlert(alert.id)}
                            className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                          >
                            Dismiss
                          </button>
                          <button className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
                            Investigate
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: FINANCIAL HEALTH SCORE */}
        {activeTab === 'health' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">🏥 Financial Health Score</h2>
              <p className="text-gray-600 mt-1">Overall company financial fitness rating</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Overall Score */}
              <div className="bg-white rounded-xl shadow-sm border-2 border-gray-200 p-8">
                <div className="text-center mb-6">
                  <div className="text-6xl font-bold mb-2" style={{ color: healthScore.overall >= 70 ? '#10B981' : healthScore.overall >= 60 ? '#3B82F6' : '#F59E0B' }}>
                    {healthScore.overall}
                    <span className="text-3xl text-gray-400">/100</span>
                  </div>
                  <div className="text-2xl font-bold text-gray-700 mb-1">Grade: {healthScore.grade}{healthScore.grade === 'B' ? '-' : ''}</div>
                  <div className="flex items-center justify-center gap-2 text-red-600">
                    <TrendingDown size={20} />
                    <span className="font-semibold capitalize">{healthScore.trend}</span>
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-6 mb-6">
                  <div className="text-center text-sm text-gray-600 mb-2">Industry Benchmark: {healthScore.benchmarkVsIndustry}/100</div>
                  <div className="text-center font-semibold text-red-600">
                    You are {healthScore.benchmarkVsIndustry - healthScore.overall} points below industry average
                  </div>
                </div>

                <button className="w-full px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-semibold">
                  Generate Full Diagnosis
                </button>
              </div>

              {/* Component Scores */}
              <div className="bg-white rounded-xl shadow-sm border-2 border-gray-200 p-8">
                <h3 className="text-lg font-bold text-gray-900 mb-6">COMPONENT SCORES</h3>
                <div className="space-y-4">
                  {Object.entries(healthScore.components).map(([key, score]) => (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700 capitalize">{key}</span>
                        <span className={`text-sm font-bold ${getHealthColor(score)}`}>
                          {score}/100 {score >= 70 ? '🟢' : score >= 50 ? '🟡' : '🔴'}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-3">
                        <div
                          className={`h-3 rounded-full transition-all ${getHealthBarColor(score)}`}
                          style={{ width: `${score}%` }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* AI Diagnosis */}
            <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl border-2 border-purple-200 p-6">
              <div className="flex items-center gap-3 mb-4">
                <Sparkles className="text-purple-600" size={24} />
                <h3 className="text-lg font-bold text-gray-900">AI DIAGNOSIS (Nova)</h3>
              </div>
              <p className="text-gray-700 leading-relaxed mb-4">{healthScore.aiSummary}</p>
            </div>

            {/* Improvement Actions */}
            <div className="bg-white rounded-xl shadow-sm border-2 border-gray-200 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">IMPROVEMENT ACTIONS</h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg">
                  <span className="text-xl">🎯</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-gray-900">Reduce DSO from 46 to 36 days</span>
                      <span className="text-sm font-bold text-green-600">+8 points</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg">
                  <span className="text-xl">🎯</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-gray-900">Fix COGS overrun (restore margin to 51%)</span>
                      <span className="text-sm font-bold text-green-600">+5 points</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg">
                  <span className="text-xl">🎯</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-gray-900">Resolve admin cost overrun</span>
                      <span className="text-sm font-bold text-green-600">+3 points</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-900">Potential score after improvements:</span>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-green-600">78/100</span>
                    <span className="text-sm text-gray-600 ml-2">(Grade A-)</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-4">
              <button className="flex-1 px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold">
                Export Health Report
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CFOServices;
