import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Send,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Bell,
  Activity,
  MessageSquare,
  Upload,
  Mic,
  Square,
  Info
} from 'lucide-react';
import { CFOTab, ChatMessage, StrategicInsight, KPIAlert, FinancialHealthScore } from '../../types/cfo';
import {
  initialChatMessages,
  mockInsights,
  mockKPIAlerts,
  mockHealthScore,
  financialContext
} from '../../data/cfoMockData';
import { callAI } from '../../services/aiProvider';
import { useAgentActivity } from '../../context/AgentActivityContext';
import { loadCFOServicesContext, saveCFOServicesContext } from '../../types/cfoServicesContext';
import { parseCFOServicesContextFromFile } from '../../utils/cfoContextParser';
import type { CFOServicesContext } from '../../types/cfoServicesContext';
import { joinApiUrl, isBackendConfigured } from '../../utils/backendOrigin';
import {
  type CFODataSource,
  SAFE_SUGGESTED_QUESTIONS,
  SOURCE_LABELS,
  applyUploadContext,
  assistantSourcesFor,
  buildChatPrompt,
  canClaimLedger,
  chatAllowed,
  emptyOperationalState,
  sourceLabel,
} from '../../lib/cfoServicesIntegrity';

interface CFOServicesProps {
  defaultTab?: CFOTab;
}

const VOICE_SUGGESTED_QUESTIONS = SAFE_SUGGESTED_QUESTIONS;
type VoiceState = 'idle' | 'recording' | 'processing' | 'speaking' | 'error';

function SourceIndicator({ source, warning }: { source: CFODataSource; warning?: string | null }) {
  const styles: Record<CFODataSource, string> = {
    demo: 'border-amber-300 bg-amber-50 text-amber-950',
    upload: 'border-blue-300 bg-blue-50 text-blue-950',
    ledger: 'border-emerald-300 bg-emerald-50 text-emerald-950',
    unavailable: 'border-slate-300 bg-slate-50 text-slate-800',
  };
  return (
    <div role="status" className={`mb-4 flex items-start gap-2 rounded-lg border px-4 py-2.5 text-sm ${styles[source]}`}>
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <p>
          <span className="font-semibold">Data source: {sourceLabel(source)}.</span>{' '}
          {source === 'demo' && 'Illustrative sample only — not your company books.'}
          {source === 'upload' && 'Figures come from a spreadsheet you uploaded — not the posted ledger.'}
          {source === 'ledger' && 'Figures come from posted ledger data.'}
          {source === 'unavailable' && 'No financial figures are loaded. Upload a file or load the labelled demo sample.'}
          {' '}For posted-ledger analysis use the{' '}
          <Link to="/ai-cfo" className="font-medium underline underline-offset-2">AI CFO Command Centre</Link>.
        </p>
        {warning && <p className="mt-1 text-xs opacity-90">{warning}</p>}
        {canClaimLedger(source) ? null : source === 'ledger' ? null : (
          <p className="mt-1 text-xs opacity-80">This page never claims live ledger status without a ledger feed.</p>
        )}
      </div>
    </div>
  );
}

const CFOServices: React.FC<CFOServicesProps> = ({ defaultTab = 'assistant' }) => {
  const navigate = useNavigate();
  const { pushAction, markActive } = useAgentActivity();
  const empty = emptyOperationalState();
  const [activeTab, setActiveTab] = useState<CFOTab>(defaultTab);
  const [dataSource, setDataSource] = useState<CFODataSource>(empty.source);
  const [messages, setMessages] = useState<ChatMessage[]>(empty.messages);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [insights, setInsights] = useState<StrategicInsight[]>(empty.insights);
  const [alerts, setAlerts] = useState<KPIAlert[]>(empty.alerts);
  const [healthScore, setHealthScore] = useState<FinancialHealthScore | null>(empty.healthScore);
  const [effectiveContext, setEffectiveContext] = useState<string>(empty.effectiveContext);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);

  const applyContext = (ctx: CFOServicesContext) => {
    const applied = applyUploadContext(ctx);
    setDataSource(applied.source);
    setInsights(applied.insights);
    setAlerts(applied.alerts);
    setHealthScore(applied.healthScore);
    setEffectiveContext(applied.effectiveContext);
    setMessages(applied.messages);
    setUploadWarning(applied.warning);
    setUploadFileName(ctx.fileName || null);
  };

  const loadDemoSample = () => {
    setDataSource('demo');
    setInsights(mockInsights);
    setAlerts(mockKPIAlerts);
    setHealthScore(mockHealthScore);
    setEffectiveContext(`DEMO / ILLUSTRATIVE SAMPLE (not posted ledger):\n${financialContext}`);
    setMessages(initialChatMessages.map((m) => ({ ...m, dataSource: 'demo' as const, timestamp: new Date().toISOString() })));
    setUploadWarning(null);
    setUploadError(null);
    setUploadFileName(null);
  };

  const clearToUnavailable = () => {
    const next = emptyOperationalState();
    setDataSource(next.source);
    setInsights(next.insights);
    setAlerts(next.alerts);
    setHealthScore(next.healthScore);
    setEffectiveContext(next.effectiveContext);
    setMessages(next.messages);
    setUploadWarning(null);
    setUploadError(null);
    setUploadFileName(null);
    try {
      localStorage.removeItem('finreport_cfo_context');
      localStorage.removeItem('cfo_services_context');
    } catch {
      /* ignore */
    }
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const ctx = await parseCFOServicesContextFromFile(file);
      if (ctx) {
        const withName = { ...ctx, fileName: file.name };
        localStorage.setItem('finreport_cfo_context', JSON.stringify(withName));
        saveCFOServicesContext(withName);
        applyContext(withName);
      } else {
        setUploadError('No usable CFO Services Context found. Incomplete or empty sheets are not filled with demo figures.');
      }
    } catch (err: any) {
      setUploadError(err?.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    const ctx = loadCFOServicesContext();
    if (ctx) applyContext(ctx);
  }, []);

  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [lastSpoken, setLastSpoken] = useState<string | null>(null);
  const [lastVoiceResponse, setLastVoiceResponse] = useState<string | null>(null);
  const [voiceAudioUrl, setVoiceAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
      dataSource,
    };
    setMessages(prev => [...prev, newUserMsg]);
    setInputMessage('');

    if (!chatAllowed(dataSource, !!effectiveContext.trim())) {
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content:
            'No financial data source is loaded. Upload a CFO Services Context file or load the labelled demo sample before asking for figures. Demo data is never used silently.',
          timestamp: new Date().toISOString(),
          sources: [SOURCE_LABELS.unavailable],
          dataSource: 'unavailable',
        },
      ]);
      return;
    }

    setIsLoading(true);

    const loadingMsg: ChatMessage = {
      id: 'loading',
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isLoading: true,
      dataSource,
    };
    setMessages(prev => [...prev, loadingMsg]);

    try {
      const prompt = buildChatPrompt(userMessage, effectiveContext, dataSource);
      const response = await callAI(prompt);

      setMessages(prev => prev.map(m =>
        m.id === 'loading'
          ? {
              ...m,
              id: Date.now().toString(),
              content: response,
              isLoading: false,
              sources: assistantSourcesFor(dataSource),
              dataSource,
            }
          : m
      ));
    } catch (error: any) {
      setMessages(prev => prev.map(m =>
        m.id === 'loading'
          ? {
              ...m,
              id: Date.now().toString(),
              content: `Request failed: ${error.message}. No demo or synthetic figures were substituted.`,
              isLoading: false,
              sources: [SOURCE_LABELS[dataSource], 'Error'],
              dataSource,
            }
          : m
      ));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestedQuestion = (question: string) => {
    setInputMessage(question);
    sendMessage(question);
  };

  const callVoiceAPI = async (transcriptOrAudio: string | Blob): Promise<void> => {
    setVoiceState('processing');
    setVoiceError(null);
    const formData = new FormData();
    if (typeof transcriptOrAudio === 'string') {
      formData.append('transcript', transcriptOrAudio);
    } else {
      formData.append('audio', transcriptOrAudio, 'recording.webm');
    }
    if (!chatAllowed(dataSource, !!effectiveContext.trim())) {
      setVoiceError('Load uploaded data or the labelled demo sample before using voice questions.');
      setVoiceState('error');
      return;
    }
    if (!isBackendConfigured()) {
      setVoiceError('Backend API not configured. Set VITE_API_URL and redeploy.');
      setVoiceState('error');
      return;
    }
    const token = localStorage.getItem('access_token');
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const res = await fetch(joinApiUrl('/api/ai/voice'), {
        method: 'POST',
        headers,
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Voice request failed');
      setLastSpoken(data.transcript || (typeof transcriptOrAudio === 'string' ? transcriptOrAudio : ''));
      setLastVoiceResponse(data.text_response || '');
      setVoiceAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        if (data.audio_base64) {
          const audioBlob = new Blob([Uint8Array.from(atob(data.audio_base64), c => c.charCodeAt(0))], { type: 'audio/mp3' });
          return URL.createObjectURL(audioBlob);
        }
        return null;
      });
      setVoiceState('speaking');
      const newUserMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content: data.transcript || String(transcriptOrAudio),
        timestamp: new Date().toISOString(),
        dataSource,
      };
      const newAssistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.text_response,
        timestamp: new Date().toISOString(),
        sources: [...assistantSourcesFor(dataSource), 'Voice AI'],
        dataSource,
      };
      setMessages((prev) => [...prev, newUserMsg, newAssistantMsg]);
      markActive('voice');
      const shortReply = (data.text_response || '').slice(0, 80) + ((data.text_response?.length || 0) > 80 ? '…' : '');
      pushAction('voice', `CFO asked: ${(data.transcript || '').slice(0, 40)} → ${shortReply}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Voice request failed';
      setVoiceError(`${msg} (no demo figures substituted)`);
      setVoiceState('error');
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError('Microphone not supported');
      setVoiceState('error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        callVoiceAPI(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setVoiceState('recording');
      setVoiceError(null);
    } catch {
      setVoiceError('Microphone access denied');
      setVoiceState('error');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
  };

  const handleVoiceChipClick = (q: string) => {
    callVoiceAPI(q);
  };

  const supportsMediaRecorder = typeof MediaRecorder !== 'undefined';

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
    <div className="min-h-screen p-6" style={{ backgroundColor: '#F0F4FF' }}>
      <div className="max-w-[1800px] mx-auto">
        <SourceIndicator source={dataSource} warning={uploadWarning} />
      </div>
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
                    <h1 className="text-3xl font-bold text-gray-900">CFO Services</h1>
                    <p className="text-gray-600 mt-1">AI Assistant · Strategic Insights · KPI Monitor · Source: {sourceLabel(dataSource)}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleUploadFile}
                aria-label="Upload CFO context file"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-70"
              >
                <Upload className="w-4 h-4" />
                <span>{uploading ? 'Uploading…' : 'Upload Data'}</span>
              </button>
              {dataSource !== 'demo' && (
                <button
                  type="button"
                  onClick={loadDemoSample}
                  className="px-3 py-2 text-sm border border-amber-400 text-amber-900 bg-amber-50 rounded-lg hover:bg-amber-100"
                >
                  Load demo sample
                </button>
              )}
              {dataSource !== 'unavailable' && (
                <button
                  type="button"
                  onClick={clearToUnavailable}
                  className="px-3 py-2 text-sm border border-slate-300 text-slate-700 bg-white rounded-lg hover:bg-slate-50"
                >
                  Clear data
                </button>
              )}
              {uploadFileName && <span className="text-sm text-gray-600">✓ {uploadFileName}</span>}
              {uploadError && <span className="text-sm text-red-600 max-w-xs">{uploadError}</span>}
              <span className="text-xs text-gray-500">Excel/CSV sheet: CFO_Services_Context</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="rounded-xl shadow-sm p-2 flex gap-2" style={{ backgroundColor: '#1E1B4B' }}>
          <button
            onClick={() => setActiveTab('assistant')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-colors ${
              activeTab === 'assistant'
                ? 'text-white'
                : 'text-white hover:opacity-90'
            }`}
            style={{ backgroundColor: activeTab === 'assistant' ? '#7C3AED' : 'transparent' }}
          >
            <MessageSquare size={20} />
            AI Assistant
          </button>
          <button
            onClick={() => setActiveTab('insights')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-colors ${
              activeTab === 'insights'
                ? 'text-white'
                : 'text-white hover:opacity-90'
            }`}
            style={{ backgroundColor: activeTab === 'insights' ? '#7C3AED' : 'transparent' }}
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
                ? 'text-white'
                : 'text-white hover:opacity-90'
            }`}
            style={{ backgroundColor: activeTab === 'monitor' ? '#7C3AED' : 'transparent' }}
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
                ? 'text-white'
                : 'text-white hover:opacity-90'
            }`}
            style={{ backgroundColor: activeTab === 'health' ? '#7C3AED' : 'transparent' }}
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
                        <span className="text-sm text-gray-600">Assistant is thinking...</span>
                      </div>
                    ) : (
                      <>
                        <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
                        {message.role === 'assistant' && (
                          <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">
                            {message.sources && <>Sources: {message.sources.join(', ')} · </>}
                            Data source: {sourceLabel(message.dataSource || dataSource)}
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
            {messages.length <= 2 && dataSource !== 'unavailable' && (
              <div className="border-t border-gray-200 p-4 bg-gray-50">
                <div className="text-xs text-gray-600 mb-2">Suggested questions:</div>
                <div className="flex flex-wrap gap-2">
                  {SAFE_SUGGESTED_QUESTIONS.map((q, idx) => (
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

            {/* Voice AI Panel */}
            <div className="border-t border-gray-200 p-4 bg-gradient-to-br from-slate-50 to-blue-50">
              <div className="text-sm font-semibold text-gray-800 mb-3">🎙 Ask by Voice</div>
              {!supportsMediaRecorder ? (
                <p className="text-sm text-amber-700">Voice not supported in this browser. Use Chrome or Edge.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    <button
                      onMouseDown={startRecording}
                      onMouseUp={stopRecording}
                      onMouseLeave={stopRecording}
                      onTouchStart={startRecording}
                      onTouchEnd={stopRecording}
                      disabled={voiceState === 'processing'}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                        voiceState === 'recording'
                          ? 'bg-red-500 text-white animate-pulse'
                          : voiceState === 'processing'
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : voiceState === 'speaking'
                          ? 'bg-blue-100 text-blue-700 border border-blue-300'
                          : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {voiceState === 'recording' ? (
                        <Square size={18} />
                      ) : voiceState === 'processing' ? (
                        <span className="flex gap-0.5">
                          <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                      ) : (
                        <Mic size={18} />
                      )}
                      {voiceState === 'recording' ? 'Listening...' : voiceState === 'processing' ? 'Thinking...' : 'Hold to Speak'}
                    </button>
                    <span className={`text-xs ${voiceState === 'speaking' ? 'text-blue-600 font-medium' : 'text-gray-600'}`}>
                      {voiceState === 'idle' && '● Ready to listen'}
                      {voiceState === 'recording' && '● Listening...'}
                      {voiceState === 'processing' && '● Thinking...'}
                      {voiceState === 'speaking' && '● Speaking reply...'}
                      {voiceState === 'error' && '● Could not understand, try again'}
                    </span>
                  </div>
                  {voiceError && <p className="text-sm text-red-600 mb-2">{voiceError}</p>}
                  {lastSpoken && (
                    <div className="mb-2 text-sm">
                      <span className="text-gray-600">Last spoken: </span>
                      <span className="font-medium">&quot;{lastSpoken}&quot;</span>
                    </div>
                  )}
                  {lastVoiceResponse && (
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <span className="text-gray-600 text-sm">Assistant: </span>
                        <p className="text-gray-800 text-sm mt-0.5">{lastVoiceResponse}</p>
                      </div>
                      {voiceAudioUrl && (
                        <div className="flex items-center gap-2">
                          {voiceState === 'speaking' && (
                            <span className="flex gap-0.5 items-end h-4">
                              {[0, 1, 2, 3, 4].map((i) => (
                                <span
                                  key={i}
                                  className="w-1 bg-blue-500 rounded-full animate-pulse"
                                  style={{ height: '12px', animationDelay: `${i * 80}ms`, animationDuration: '0.5s' }}
                                />
                              ))}
                            </span>
                          )}
                          <audio
                            ref={audioRef}
                            src={voiceAudioUrl}
                            controls
                            autoPlay
                            className="h-8"
                            onEnded={() => setVoiceState('idle')}
                            onPlay={() => setVoiceState('speaking')}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="text-xs text-gray-600 mb-2">Voice suggested questions:</div>
                    <div className="flex flex-wrap gap-2">
                      {VOICE_SUGGESTED_QUESTIONS.map((q, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleVoiceChipClick(q)}
                          disabled={voiceState === 'processing'}
                          className="px-3 py-1.5 text-xs bg-white border border-purple-200 rounded-full hover:bg-purple-50 text-purple-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

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
                <h2 className="text-2xl font-bold text-gray-900">Strategic Insights</h2>
                <p className="text-gray-600 mt-1">Source: {sourceLabel(dataSource)}</p>
              </div>
            </div>

            {insights.length === 0 && (
              <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center text-gray-600">
                No insights loaded. Upload a CFO Services Context file or load the labelled demo sample.
              </div>
            )}

            {/* Immediate Action Required */}
            {insights.some(i => i.urgency === 'immediate') && (
            <div>
              <h3 className="text-lg font-bold text-red-600 mb-3">IMMEDIATE ACTION REQUIRED</h3>
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
            )}

            {/* Review This Week */}
            {insights.some(i => i.urgency === 'this_week') && (
            <div>
              <h3 className="text-lg font-bold text-amber-600 mb-3">REVIEW THIS WEEK</h3>
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
            )}

            {/* Positive Highlights */}
            {insights.some(i => i.urgency === 'this_month') && (
            <div>
              <h3 className="text-lg font-bold text-green-600 mb-3">POSITIVE HIGHLIGHTS</h3>
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
            )}
          </div>
        )}

        {/* TAB 3: KPI MONITOR */}
        {activeTab === 'monitor' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">KPI Monitor</h2>
                <p className="text-gray-600 mt-1">Source: {sourceLabel(dataSource)} · {alerts.length} active alerts</p>
              </div>
            </div>

            {alerts.length === 0 && (
              <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center text-gray-600">
                No KPI alerts loaded. Upload a complete context file or load the labelled demo sample.
              </div>
            )}

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
              <h2 className="text-2xl font-bold text-gray-900">Financial Health Score</h2>
              <p className="text-gray-600 mt-1">Source: {sourceLabel(dataSource)}</p>
            </div>

            {!healthScore && (
              <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center text-gray-600">
                No health score available. Partial uploads do not invent a score. Include a Health Score section in your spreadsheet, or load the labelled demo sample.
              </div>
            )}

            {healthScore && (
            <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl shadow-sm border-2 border-gray-200 p-8">
                <div className="text-center mb-6">
                  <div className="text-6xl font-bold mb-2" style={{ color: healthScore.overall >= 70 ? '#10B981' : healthScore.overall >= 60 ? '#3B82F6' : '#F59E0B' }}>
                    {healthScore.overall}
                    <span className="text-3xl text-gray-400">/100</span>
                  </div>
                  <div className="text-2xl font-bold text-gray-700 mb-1">Grade: {healthScore.grade}</div>
                  <div className={`flex items-center justify-center gap-2 ${healthScore.trend === 'improving' ? 'text-green-600' : healthScore.trend === 'declining' ? 'text-red-600' : 'text-slate-600'}`}>
                    {healthScore.trend === 'improving' ? <TrendingUp size={20} /> : healthScore.trend === 'declining' ? <TrendingDown size={20} /> : <Activity size={20} />}
                    <span className="font-semibold capitalize">{healthScore.trend}</span>
                  </div>
                </div>

                {healthScore.benchmarkVsIndustry > 0 && (
                <div className="border-t border-gray-200 pt-6 mb-6">
                  <div className="text-center text-sm text-gray-600 mb-2">Industry Benchmark: {healthScore.benchmarkVsIndustry}/100</div>
                  <div className="text-center font-semibold text-slate-700">
                    {healthScore.overall >= healthScore.benchmarkVsIndustry
                      ? `${healthScore.overall - healthScore.benchmarkVsIndustry} points above benchmark`
                      : `${healthScore.benchmarkVsIndustry - healthScore.overall} points below benchmark`}
                  </div>
                </div>
                )}
              </div>

              <div className="bg-white rounded-xl shadow-sm border-2 border-gray-200 p-8">
                <h3 className="text-lg font-bold text-gray-900 mb-6">COMPONENT SCORES</h3>
                <div className="space-y-4">
                  {Object.entries(healthScore.components).map(([key, score]) => (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700 capitalize">{key}</span>
                        <span className={`text-sm font-bold ${getHealthColor(score)}`}>
                          {score}/100
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-3">
                        <div
                          className={`h-3 rounded-full transition-all ${getHealthBarColor(score)}`}
                          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl border-2 border-purple-200 p-6">
              <div className="flex items-center gap-3 mb-4">
                <Sparkles className="text-purple-600" size={24} />
                <h3 className="text-lg font-bold text-gray-900">AI DIAGNOSIS</h3>
                <span className="text-xs text-purple-800 bg-purple-100 px-2 py-0.5 rounded-full">{sourceLabel(dataSource)}</span>
              </div>
              <p className="text-gray-700 leading-relaxed mb-4">{healthScore.aiSummary}</p>
            </div>
            </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CFOServices;
