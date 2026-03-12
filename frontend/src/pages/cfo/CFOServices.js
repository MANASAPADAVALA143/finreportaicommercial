import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, Sparkles, TrendingDown, Bell, Activity, MessageSquare, Upload, Mic, Square } from 'lucide-react';
import { initialChatMessages, suggestedQuestions, mockInsights, mockKPIAlerts, mockHealthScore, financialContext } from '../../data/cfoMockData';
import { callAI } from '../../services/aiProvider';
import { useAgentActivity } from '../../context/AgentActivityContext';
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const VOICE_SUGGESTED_QUESTIONS = [
    'What is our cash runway?',
    'Why did costs increase this month?',
    'Which department is over budget?',
    'Should we hire or automate?',
    'What is our financial health score?',
];
const CFOServices = ({ defaultTab = 'assistant' }) => {
    const navigate = useNavigate();
    const { pushAction, markActive } = useAgentActivity();
    const [activeTab, setActiveTab] = useState(defaultTab);
    const [messages, setMessages] = useState(initialChatMessages);
    const [inputMessage, setInputMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [insights, setInsights] = useState(mockInsights);
    const [alerts, setAlerts] = useState(mockKPIAlerts);
    const [healthScore] = useState(mockHealthScore);
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const [voiceState, setVoiceState] = useState('idle');
    const [voiceError, setVoiceError] = useState(null);
    const [lastSpoken, setLastSpoken] = useState(null);
    const [lastVoiceResponse, setLastVoiceResponse] = useState(null);
    const [voiceAudioUrl, setVoiceAudioUrl] = useState(null);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const audioRef = useRef(null);
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };
    useEffect(() => {
        scrollToBottom();
    }, [messages]);
    const sendMessage = async (userMessage) => {
        if (!userMessage.trim() || isLoading)
            return;
        const newUserMsg = {
            id: Date.now().toString(),
            role: 'user',
            content: userMessage,
            timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, newUserMsg]);
        setInputMessage('');
        setIsLoading(true);
        const loadingMsg = {
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
            setMessages(prev => prev.map(m => m.id === 'loading'
                ? {
                    ...m,
                    id: Date.now().toString(),
                    content: response,
                    isLoading: false,
                    sources: ['Variance Analysis', 'KPI Dashboard', 'Cash Flow']
                }
                : m));
        }
        catch (error) {
            setMessages(prev => prev.map(m => m.id === 'loading'
                ? {
                    ...m,
                    id: Date.now().toString(),
                    content: `❌ Sorry, I encountered an error: ${error.message}. Please try again.`,
                    isLoading: false
                }
                : m));
        }
        finally {
            setIsLoading(false);
        }
    };
    const handleSuggestedQuestion = (question) => {
        setInputMessage(question);
        inputRef.current?.focus();
    };
    const callVoiceAPI = async (transcriptOrAudio) => {
        setVoiceState('processing');
        setVoiceError(null);
        const formData = new FormData();
        if (typeof transcriptOrAudio === 'string') {
            formData.append('transcript', transcriptOrAudio);
        }
        else {
            formData.append('audio', transcriptOrAudio, 'recording.webm');
        }
        const token = localStorage.getItem('access_token');
        const headers = {};
        if (token)
            headers.Authorization = `Bearer ${token}`;
        try {
            const res = await fetch(`${API_BASE}/api/nova/voice`, {
                method: 'POST',
                headers,
                body: formData,
            });
            const data = await res.json();
            if (!res.ok)
                throw new Error(data.detail || 'Voice request failed');
            setLastSpoken(data.transcript || (typeof transcriptOrAudio === 'string' ? transcriptOrAudio : ''));
            setLastVoiceResponse(data.text_response || '');
            setVoiceAudioUrl((prev) => {
                if (prev)
                    URL.revokeObjectURL(prev);
                if (data.audio_base64) {
                    const audioBlob = new Blob([Uint8Array.from(atob(data.audio_base64), c => c.charCodeAt(0))], { type: 'audio/mp3' });
                    return URL.createObjectURL(audioBlob);
                }
                return null;
            });
            setVoiceState('speaking');
            const newUserMsg = {
                id: Date.now().toString(),
                role: 'user',
                content: data.transcript || String(transcriptOrAudio),
                timestamp: new Date().toISOString(),
            };
            const newAssistantMsg = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: data.text_response,
                timestamp: new Date().toISOString(),
                sources: ['Voice AI · Nova 2 Sonic'],
            };
            setMessages((prev) => [...prev, newUserMsg, newAssistantMsg]);
            markActive('voice');
            const shortReply = (data.text_response || '').slice(0, 80) + ((data.text_response?.length || 0) > 80 ? '…' : '');
            pushAction('voice', `CFO asked: ${(data.transcript || '').slice(0, 40)} → ${shortReply}`);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Voice request failed';
            setVoiceError(msg);
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
                if (e.data.size)
                    audioChunksRef.current.push(e.data);
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
        }
        catch {
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
    const handleVoiceChipClick = (q) => {
        callVoiceAPI(q);
    };
    const supportsMediaRecorder = typeof MediaRecorder !== 'undefined';
    const dismissAlert = (id) => {
        setAlerts(prev => prev.filter(a => a.id !== id));
    };
    const getHealthColor = (score) => {
        if (score >= 80)
            return 'text-green-600';
        if (score >= 60)
            return 'text-blue-600';
        if (score >= 40)
            return 'text-amber-600';
        return 'text-red-600';
    };
    const getHealthBarColor = (score) => {
        if (score >= 80)
            return 'bg-green-500';
        if (score >= 60)
            return 'bg-blue-500';
        if (score >= 40)
            return 'bg-amber-500';
        return 'bg-red-500';
    };
    const getCategoryIcon = (category) => {
        switch (category) {
            case 'revenue': return '💰';
            case 'cost': return '📊';
            case 'cash': return '💵';
            case 'risk': return '⚠️';
            case 'opportunity': return '🚀';
            default: return '💡';
        }
    };
    const getUrgencyColor = (urgency) => {
        switch (urgency) {
            case 'immediate': return 'border-red-500 bg-red-50';
            case 'this_week': return 'border-amber-500 bg-amber-50';
            default: return 'border-blue-500 bg-blue-50';
        }
    };
    const getSeverityBadge = (severity) => {
        switch (severity) {
            case 'critical':
                return _jsx("span", { className: "px-2 py-1 text-xs font-semibold bg-red-100 text-red-700 rounded-full", children: "\uD83D\uDD34 CRITICAL" });
            case 'warning':
                return _jsx("span", { className: "px-2 py-1 text-xs font-semibold bg-amber-100 text-amber-700 rounded-full", children: "\u26A0\uFE0F WARNING" });
            default:
                return _jsx("span", { className: "px-2 py-1 text-xs font-semibold bg-blue-100 text-blue-700 rounded-full", children: "\u2139\uFE0F INFO" });
        }
    };
    const criticalAlerts = alerts.filter(a => a.severity === 'critical');
    const warningAlerts = alerts.filter(a => a.severity === 'warning');
    return (_jsxs("div", { className: "min-h-screen p-6", style: { backgroundColor: '#F0F4FF' }, children: [_jsx("div", { className: "max-w-[1800px] mx-auto mb-6", children: _jsx("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 p-6", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("button", { onClick: () => navigate('/dashboard'), className: "p-2 hover:bg-gray-100 rounded-lg transition-colors", children: _jsx(ArrowLeft, { size: 24, className: "text-gray-700" }) }), _jsx("div", { children: _jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Sparkles, { size: 32, className: "text-purple-600" }), _jsxs("div", { children: [_jsx("h1", { className: "text-3xl font-bold text-gray-900", children: "\uD83E\uDD16 CFO Services" }), _jsx("p", { className: "text-gray-600 mt-1", children: "AI Assistant \u00B7 Strategic Insights \u00B7 KPI Monitor" })] })] }) })] }), _jsxs("div", { className: "flex items-center gap-4", children: [_jsxs("button", { onClick: () => navigate('/upload-data'), className: "flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm", children: [_jsx(Upload, { className: "w-4 h-4" }), _jsx("span", { children: "Upload Data" })] }), _jsxs("div", { className: "text-right", children: [_jsx("div", { className: "text-sm text-gray-600", children: "Powered by" }), _jsx("div", { className: "font-semibold text-purple-600", children: "Amazon Nova" })] })] })] }) }) }), _jsx("div", { className: "max-w-[1800px] mx-auto mb-6", children: _jsxs("div", { className: "rounded-xl shadow-sm p-2 flex gap-2", style: { backgroundColor: '#1E1B4B' }, children: [_jsxs("button", { onClick: () => setActiveTab('assistant'), className: `flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-colors ${activeTab === 'assistant'
                                ? 'text-white'
                                : 'text-white hover:opacity-90'}`, style: { backgroundColor: activeTab === 'assistant' ? '#7C3AED' : 'transparent' }, children: [_jsx(MessageSquare, { size: 20 }), "AI Assistant"] }), _jsxs("button", { onClick: () => setActiveTab('insights'), className: `flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-colors ${activeTab === 'insights'
                                ? 'text-white'
                                : 'text-white hover:opacity-90'}`, style: { backgroundColor: activeTab === 'insights' ? '#7C3AED' : 'transparent' }, children: [_jsx(Sparkles, { size: 20 }), "Strategic Insights", insights.filter(i => i.urgency === 'immediate').length > 0 && (_jsx("span", { className: "bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full", children: insights.filter(i => i.urgency === 'immediate').length }))] }), _jsxs("button", { onClick: () => setActiveTab('monitor'), className: `flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-colors ${activeTab === 'monitor'
                                ? 'text-white'
                                : 'text-white hover:opacity-90'}`, style: { backgroundColor: activeTab === 'monitor' ? '#7C3AED' : 'transparent' }, children: [_jsx(Bell, { size: 20 }), "KPI Monitor", criticalAlerts.length > 0 && (_jsx("span", { className: "bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full", children: criticalAlerts.length }))] }), _jsxs("button", { onClick: () => setActiveTab('health'), className: `flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-colors ${activeTab === 'health'
                                ? 'text-white'
                                : 'text-white hover:opacity-90'}`, style: { backgroundColor: activeTab === 'health' ? '#7C3AED' : 'transparent' }, children: [_jsx(Activity, { size: 20 }), "Health Score"] })] }) }), _jsxs("div", { className: "max-w-[1800px] mx-auto", children: [activeTab === 'assistant' && (_jsxs("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col", style: { height: 'calc(100vh - 320px)' }, children: [_jsxs("div", { className: "flex-1 overflow-y-auto p-6 space-y-4", children: [messages.map((message) => (_jsx("div", { className: `flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`, children: _jsx("div", { className: `max-w-[80%] ${message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'} rounded-2xl p-4`, children: message.isLoading ? (_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("div", { className: "flex gap-1", children: [_jsx("div", { className: "w-2 h-2 bg-gray-400 rounded-full animate-bounce", style: { animationDelay: '0ms' } }), _jsx("div", { className: "w-2 h-2 bg-gray-400 rounded-full animate-bounce", style: { animationDelay: '150ms' } }), _jsx("div", { className: "w-2 h-2 bg-gray-400 rounded-full animate-bounce", style: { animationDelay: '300ms' } })] }), _jsx("span", { className: "text-sm text-gray-600", children: "Nova is thinking..." })] })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "whitespace-pre-wrap text-sm leading-relaxed", children: message.content }), message.sources && message.role === 'assistant' && (_jsxs("div", { className: "mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500", children: ["Sources: ", message.sources.join(', ')] }))] })) }) }, message.id))), _jsx("div", { ref: messagesEndRef })] }), messages.length <= 2 && (_jsxs("div", { className: "border-t border-gray-200 p-4 bg-gray-50", children: [_jsx("div", { className: "text-xs text-gray-600 mb-2", children: "Suggested questions:" }), _jsx("div", { className: "flex flex-wrap gap-2", children: suggestedQuestions.slice(0, 4).map((q, idx) => (_jsx("button", { onClick: () => handleSuggestedQuestion(q), className: "px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-full hover:bg-gray-100 transition-colors", children: q }, idx))) })] })), _jsxs("div", { className: "border-t border-gray-200 p-4 bg-gradient-to-br from-slate-50 to-blue-50", children: [_jsx("div", { className: "text-sm font-semibold text-gray-800 mb-3", children: "\uD83C\uDF99 Ask Nova by Voice" }), !supportsMediaRecorder ? (_jsx("p", { className: "text-sm text-amber-700", children: "Voice not supported in this browser. Use Chrome or Edge." })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex flex-wrap items-center gap-3 mb-3", children: [_jsxs("button", { onMouseDown: startRecording, onMouseUp: stopRecording, onMouseLeave: stopRecording, onTouchStart: startRecording, onTouchEnd: stopRecording, disabled: voiceState === 'processing', className: `flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${voiceState === 'recording'
                                                            ? 'bg-red-500 text-white animate-pulse'
                                                            : voiceState === 'processing'
                                                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'}`, children: [voiceState === 'recording' ? _jsx(Square, { size: 18 }) : _jsx(Mic, { size: 18 }), voiceState === 'recording' ? 'Listening...' : 'Hold to Speak'] }), _jsxs("span", { className: "text-xs text-gray-600", children: [voiceState === 'idle' && '● Ready to listen', voiceState === 'recording' && '● Listening...', voiceState === 'processing' && '● Nova is thinking...', voiceState === 'speaking' && '● Nova is speaking...', voiceState === 'error' && '● Could not understand, try again'] })] }), voiceError && _jsx("p", { className: "text-sm text-red-600 mb-2", children: voiceError }), lastSpoken && (_jsxs("div", { className: "mb-2 text-sm", children: [_jsx("span", { className: "text-gray-600", children: "Last spoken: " }), _jsxs("span", { className: "font-medium", children: ["\"", lastSpoken, "\""] })] })), lastVoiceResponse && (_jsxs("div", { className: "flex flex-wrap items-start gap-3", children: [_jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("span", { className: "text-gray-600 text-sm", children: "Nova replied: " }), _jsx("p", { className: "text-gray-800 text-sm mt-0.5", children: lastVoiceResponse })] }), voiceAudioUrl && (_jsx("audio", { ref: audioRef, src: voiceAudioUrl, controls: true, autoPlay: true, className: "h-8", onEnded: () => setVoiceState('idle'), onPlay: () => setVoiceState('speaking') }))] })), _jsxs("div", { className: "mt-3 pt-3 border-t border-gray-200", children: [_jsx("div", { className: "text-xs text-gray-600 mb-2", children: "Voice suggested questions:" }), _jsx("div", { className: "flex flex-wrap gap-2", children: VOICE_SUGGESTED_QUESTIONS.map((q, idx) => (_jsx("button", { onClick: () => handleVoiceChipClick(q), disabled: voiceState === 'processing', className: "px-3 py-1.5 text-xs bg-white border border-purple-200 rounded-full hover:bg-purple-50 text-purple-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed", children: q }, idx))) })] })] }))] }), _jsx("div", { className: "border-t border-gray-200 p-4", children: _jsxs("div", { className: "flex gap-3", children: [_jsx("input", { ref: inputRef, type: "text", value: inputMessage, onChange: (e) => setInputMessage(e.target.value), onKeyPress: (e) => e.key === 'Enter' && sendMessage(inputMessage), placeholder: "Type your question here...", disabled: isLoading, className: "flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50" }), _jsxs("button", { onClick: () => sendMessage(inputMessage), disabled: !inputMessage.trim() || isLoading, className: "px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2", children: [_jsx(Send, { size: 20 }), "Send"] })] }) })] })), activeTab === 'insights' && (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "\uD83D\uDCA1 Strategic Insights" }), _jsx("p", { className: "text-gray-600 mt-1", children: "AI-generated analysis of your financial position \u00B7 Last updated: Today 8:00 AM" })] }), _jsxs("button", { className: "px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2", children: [_jsx(Sparkles, { size: 18 }), "Refresh Insights"] })] }), _jsxs("div", { children: [_jsx("h3", { className: "text-lg font-bold text-red-600 mb-3", children: "\uD83D\uDD34 IMMEDIATE ACTION REQUIRED" }), _jsx("div", { className: "space-y-4", children: insights.filter(i => i.urgency === 'immediate').map(insight => (_jsxs("div", { className: `border-2 rounded-xl p-6 ${getUrgencyColor(insight.urgency)}`, children: [_jsxs("div", { className: "flex items-start justify-between mb-3", children: [_jsxs("div", { className: "flex items-start gap-3", children: [_jsx("span", { className: "text-2xl", children: getCategoryIcon(insight.category) }), _jsxs("div", { children: [_jsx("h4", { className: "font-bold text-gray-900 text-lg", children: insight.title }), _jsx("p", { className: "text-sm text-gray-700 mt-1", children: insight.summary })] })] }), _jsxs("span", { className: `px-3 py-1 text-xs font-semibold rounded-full ${insight.impact === 'high' ? 'bg-red-100 text-red-700' :
                                                                insight.impact === 'medium' ? 'bg-amber-100 text-amber-700' :
                                                                    'bg-blue-100 text-blue-700'}`, children: ["Impact: ", insight.impact.toUpperCase(), " ", insight.impact === 'high' ? '🔴' : insight.impact === 'medium' ? '⚠️' : 'ℹ️'] })] }), _jsx("p", { className: "text-sm text-gray-700 mb-4", children: insight.detail }), insight.metric && (_jsx("div", { className: "bg-white bg-opacity-50 rounded-lg p-3 mb-4", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-xs text-gray-600", children: insight.metric.label }), _jsxs("div", { className: "text-right", children: [_jsx("span", { className: "font-bold text-gray-900", children: insight.metric.value }), _jsx("span", { className: "text-xs text-gray-600 ml-2", children: insight.metric.change })] })] }) })), _jsxs("div", { className: "bg-white bg-opacity-70 rounded-lg p-3 mb-4", children: [_jsx("div", { className: "text-xs font-semibold text-gray-700 mb-1", children: "RECOMMENDED ACTION:" }), _jsx("div", { className: "text-sm text-gray-900", children: insight.action })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { className: "px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors", children: "Ask AI More" }), _jsx("button", { className: "px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors", children: "Add to Actions" })] })] }, insight.id))) })] }), _jsxs("div", { children: [_jsx("h3", { className: "text-lg font-bold text-amber-600 mb-3", children: "\u26A0\uFE0F REVIEW THIS WEEK" }), _jsx("div", { className: "space-y-4", children: insights.filter(i => i.urgency === 'this_week').map(insight => (_jsxs("div", { className: `border-2 rounded-xl p-6 ${getUrgencyColor(insight.urgency)}`, children: [_jsxs("div", { className: "flex items-start justify-between mb-3", children: [_jsxs("div", { className: "flex items-start gap-3", children: [_jsx("span", { className: "text-2xl", children: getCategoryIcon(insight.category) }), _jsxs("div", { children: [_jsx("h4", { className: "font-bold text-gray-900 text-lg", children: insight.title }), _jsx("p", { className: "text-sm text-gray-700 mt-1", children: insight.summary })] })] }), _jsxs("span", { className: `px-3 py-1 text-xs font-semibold rounded-full ${insight.impact === 'high' ? 'bg-red-100 text-red-700' :
                                                                insight.impact === 'medium' ? 'bg-amber-100 text-amber-700' :
                                                                    'bg-blue-100 text-blue-700'}`, children: ["Impact: ", insight.impact.toUpperCase(), " ", insight.impact === 'medium' ? '⚠️' : 'ℹ️'] })] }), _jsx("p", { className: "text-sm text-gray-700 mb-4", children: insight.detail }), insight.metric && (_jsx("div", { className: "bg-white bg-opacity-50 rounded-lg p-3 mb-4", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-xs text-gray-600", children: insight.metric.label }), _jsxs("div", { className: "text-right", children: [_jsx("span", { className: "font-bold text-gray-900", children: insight.metric.value }), _jsx("span", { className: "text-xs text-gray-600 ml-2", children: insight.metric.change })] })] }) })), _jsxs("div", { className: "bg-white bg-opacity-70 rounded-lg p-3 mb-4", children: [_jsx("div", { className: "text-xs font-semibold text-gray-700 mb-1", children: "RECOMMENDED ACTION:" }), _jsx("div", { className: "text-sm text-gray-900", children: insight.action })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { className: "px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors", children: "Ask AI More" }), _jsx("button", { className: "px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors", children: "Add to Actions" })] })] }, insight.id))) })] }), _jsxs("div", { children: [_jsx("h3", { className: "text-lg font-bold text-green-600 mb-3", children: "\u2705 POSITIVE HIGHLIGHTS" }), _jsx("div", { className: "space-y-4", children: insights.filter(i => i.urgency === 'this_month').map(insight => (_jsxs("div", { className: `border-2 rounded-xl p-6 ${getUrgencyColor(insight.urgency)}`, children: [_jsxs("div", { className: "flex items-start justify-between mb-3", children: [_jsxs("div", { className: "flex items-start gap-3", children: [_jsx("span", { className: "text-2xl", children: getCategoryIcon(insight.category) }), _jsxs("div", { children: [_jsx("h4", { className: "font-bold text-gray-900 text-lg", children: insight.title }), _jsx("p", { className: "text-sm text-gray-700 mt-1", children: insight.summary })] })] }), _jsxs("span", { className: "px-3 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-700", children: ["Impact: ", insight.impact.toUpperCase(), " \u2705"] })] }), _jsx("p", { className: "text-sm text-gray-700 mb-4", children: insight.detail }), insight.metric && (_jsx("div", { className: "bg-white bg-opacity-50 rounded-lg p-3 mb-4", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-xs text-gray-600", children: insight.metric.label }), _jsxs("div", { className: "text-right", children: [_jsx("span", { className: "font-bold text-gray-900", children: insight.metric.value }), _jsx("span", { className: "text-xs text-gray-600 ml-2", children: insight.metric.change })] })] }) })), insight.action && (_jsxs("div", { className: "bg-white bg-opacity-70 rounded-lg p-3", children: [_jsx("div", { className: "text-xs font-semibold text-gray-700 mb-1", children: "RECOMMENDED ACTION:" }), _jsx("div", { className: "text-sm text-gray-900", children: insight.action })] }))] }, insight.id))) })] })] })), activeTab === 'monitor' && (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "\uD83D\uDD14 KPI Monitor" }), _jsxs("p", { className: "text-gray-600 mt-1", children: ["Automated alerts when KPIs breach thresholds \u00B7 ", alerts.length, " active alerts"] })] }), _jsx("button", { className: "px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors", children: "Set Thresholds" })] }), criticalAlerts.length > 0 && (_jsxs("div", { children: [_jsxs("h3", { className: "text-lg font-bold text-red-600 mb-3", children: ["\uD83D\uDD34 CRITICAL (", criticalAlerts.length, ")"] }), _jsx("div", { className: "space-y-4", children: criticalAlerts.map(alert => (_jsxs("div", { className: "bg-white border-2 border-red-500 rounded-xl p-6", children: [_jsx("div", { className: "flex items-start justify-between mb-4", children: _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-3 mb-2", children: [_jsx("h4", { className: "font-bold text-gray-900 text-lg", children: alert.kpi }), getSeverityBadge(alert.severity)] }), _jsx("p", { className: "text-sm text-red-700 font-medium", children: alert.message })] }) }), _jsxs("div", { className: "grid grid-cols-3 gap-4 mb-4 bg-red-50 rounded-lg p-4", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs text-gray-600 mb-1", children: "Current" }), _jsxs("div", { className: "font-bold text-gray-900", children: [alert.current, alert.kpi.includes('%') || alert.kpi.includes('Margin') ? '%' : alert.kpi.includes('days') ? ' days' : ''] })] }), _jsxs("div", { children: [_jsx("div", { className: "text-xs text-gray-600 mb-1", children: "Threshold" }), _jsxs("div", { className: "font-bold text-gray-900", children: [alert.threshold, alert.kpi.includes('%') || alert.kpi.includes('Margin') ? '%' : alert.kpi.includes('days') ? ' days' : ''] })] }), _jsxs("div", { children: [_jsx("div", { className: "text-xs text-gray-600 mb-1", children: "Gap" }), _jsxs("div", { className: "font-bold text-red-600", children: [alert.current > alert.threshold ? '▲' : '▼', " ", Math.abs(alert.current - alert.threshold).toFixed(1), alert.kpi.includes('%') || alert.kpi.includes('Margin') ? 'pp' : alert.kpi.includes('days') ? ' days' : ''] })] })] }), _jsxs("div", { className: "bg-gray-50 rounded-lg p-4 mb-4", children: [_jsx("div", { className: "text-xs font-semibold text-gray-700 mb-1", children: "Recommendation:" }), _jsx("div", { className: "text-sm text-gray-900", children: alert.recommendation })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("span", { className: "text-xs text-gray-500", children: ["Triggered: ", new Date(alert.triggeredAt).toLocaleString()] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { onClick: () => dismissAlert(alert.id), className: "px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors", children: "Dismiss" }), _jsx("button", { className: "px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors", children: "Investigate" })] })] })] }, alert.id))) })] })), warningAlerts.length > 0 && (_jsxs("div", { children: [_jsxs("h3", { className: "text-lg font-bold text-amber-600 mb-3", children: ["\u26A0\uFE0F WARNING (", warningAlerts.length, ")"] }), _jsx("div", { className: "space-y-4", children: warningAlerts.map(alert => (_jsxs("div", { className: "bg-white border-2 border-amber-500 rounded-xl p-6", children: [_jsx("div", { className: "flex items-start justify-between mb-4", children: _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-3 mb-2", children: [_jsx("h4", { className: "font-bold text-gray-900 text-lg", children: alert.kpi }), getSeverityBadge(alert.severity)] }), _jsx("p", { className: "text-sm text-amber-700 font-medium", children: alert.message })] }) }), _jsxs("div", { className: "grid grid-cols-3 gap-4 mb-4 bg-amber-50 rounded-lg p-4", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs text-gray-600 mb-1", children: "Current" }), _jsxs("div", { className: "font-bold text-gray-900", children: [alert.current, alert.kpi.includes('%') || alert.kpi.includes('Margin') ? '%' : alert.kpi.includes('days') ? ' days' : ''] })] }), _jsxs("div", { children: [_jsx("div", { className: "text-xs text-gray-600 mb-1", children: "Threshold" }), _jsxs("div", { className: "font-bold text-gray-900", children: [alert.threshold, alert.kpi.includes('%') || alert.kpi.includes('Margin') ? '%' : alert.kpi.includes('days') ? ' days' : ''] })] }), _jsxs("div", { children: [_jsx("div", { className: "text-xs text-gray-600 mb-1", children: "Gap" }), _jsxs("div", { className: "font-bold text-amber-600", children: [alert.current > alert.threshold ? '▲' : '▼', " ", Math.abs(alert.current - alert.threshold).toFixed(1), alert.kpi.includes('%') || alert.kpi.includes('Margin') ? 'pp' : ''] })] })] }), _jsxs("div", { className: "bg-gray-50 rounded-lg p-4 mb-4", children: [_jsx("div", { className: "text-xs font-semibold text-gray-700 mb-1", children: "Recommendation:" }), _jsx("div", { className: "text-sm text-gray-900", children: alert.recommendation })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("span", { className: "text-xs text-gray-500", children: ["Triggered: ", new Date(alert.triggeredAt).toLocaleString()] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { onClick: () => dismissAlert(alert.id), className: "px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors", children: "Dismiss" }), _jsx("button", { className: "px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors", children: "Investigate" })] })] })] }, alert.id))) })] }))] })), activeTab === 'health' && (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "\uD83C\uDFE5 Financial Health Score" }), _jsx("p", { className: "text-gray-600 mt-1", children: "Overall company financial fitness rating" })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6", children: [_jsxs("div", { className: "bg-white rounded-xl shadow-sm border-2 border-gray-200 p-8", children: [_jsxs("div", { className: "text-center mb-6", children: [_jsxs("div", { className: "text-6xl font-bold mb-2", style: { color: healthScore.overall >= 70 ? '#10B981' : healthScore.overall >= 60 ? '#3B82F6' : '#F59E0B' }, children: [healthScore.overall, _jsx("span", { className: "text-3xl text-gray-400", children: "/100" })] }), _jsxs("div", { className: "text-2xl font-bold text-gray-700 mb-1", children: ["Grade: ", healthScore.grade, healthScore.grade === 'B' ? '-' : ''] }), _jsxs("div", { className: "flex items-center justify-center gap-2 text-red-600", children: [_jsx(TrendingDown, { size: 20 }), _jsx("span", { className: "font-semibold capitalize", children: healthScore.trend })] })] }), _jsxs("div", { className: "border-t border-gray-200 pt-6 mb-6", children: [_jsxs("div", { className: "text-center text-sm text-gray-600 mb-2", children: ["Industry Benchmark: ", healthScore.benchmarkVsIndustry, "/100"] }), _jsxs("div", { className: "text-center font-semibold text-red-600", children: ["You are ", healthScore.benchmarkVsIndustry - healthScore.overall, " points below industry average"] })] }), _jsx("button", { className: "w-full px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-semibold", children: "Generate Full Diagnosis" })] }), _jsxs("div", { className: "bg-white rounded-xl shadow-sm border-2 border-gray-200 p-8", children: [_jsx("h3", { className: "text-lg font-bold text-gray-900 mb-6", children: "COMPONENT SCORES" }), _jsx("div", { className: "space-y-4", children: Object.entries(healthScore.components).map(([key, score]) => (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("span", { className: "text-sm font-medium text-gray-700 capitalize", children: key }), _jsxs("span", { className: `text-sm font-bold ${getHealthColor(score)}`, children: [score, "/100 ", score >= 70 ? '🟢' : score >= 50 ? '🟡' : '🔴'] })] }), _jsx("div", { className: "w-full bg-gray-200 rounded-full h-3", children: _jsx("div", { className: `h-3 rounded-full transition-all ${getHealthBarColor(score)}`, style: { width: `${score}%` } }) })] }, key))) })] })] }), _jsxs("div", { className: "bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl border-2 border-purple-200 p-6", children: [_jsxs("div", { className: "flex items-center gap-3 mb-4", children: [_jsx(Sparkles, { className: "text-purple-600", size: 24 }), _jsx("h3", { className: "text-lg font-bold text-gray-900", children: "AI DIAGNOSIS (Nova)" })] }), _jsx("p", { className: "text-gray-700 leading-relaxed mb-4", children: healthScore.aiSummary })] }), _jsxs("div", { className: "bg-white rounded-xl shadow-sm border-2 border-gray-200 p-6", children: [_jsx("h3", { className: "text-lg font-bold text-gray-900 mb-4", children: "IMPROVEMENT ACTIONS" }), _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex items-start gap-3 p-4 bg-blue-50 rounded-lg", children: [_jsx("span", { className: "text-xl", children: "\uD83C\uDFAF" }), _jsx("div", { className: "flex-1", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-semibold text-gray-900", children: "Reduce DSO from 46 to 36 days" }), _jsx("span", { className: "text-sm font-bold text-green-600", children: "+8 points" })] }) })] }), _jsxs("div", { className: "flex items-start gap-3 p-4 bg-blue-50 rounded-lg", children: [_jsx("span", { className: "text-xl", children: "\uD83C\uDFAF" }), _jsx("div", { className: "flex-1", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-semibold text-gray-900", children: "Fix COGS overrun (restore margin to 51%)" }), _jsx("span", { className: "text-sm font-bold text-green-600", children: "+5 points" })] }) })] }), _jsxs("div", { className: "flex items-start gap-3 p-4 bg-blue-50 rounded-lg", children: [_jsx("span", { className: "text-xl", children: "\uD83C\uDFAF" }), _jsx("div", { className: "flex-1", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-semibold text-gray-900", children: "Resolve admin cost overrun" }), _jsx("span", { className: "text-sm font-bold text-green-600", children: "+3 points" })] }) })] })] }), _jsx("div", { className: "mt-6 p-4 bg-green-50 rounded-lg border border-green-200", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-semibold text-gray-900", children: "Potential score after improvements:" }), _jsxs("div", { className: "text-right", children: [_jsx("span", { className: "text-2xl font-bold text-green-600", children: "78/100" }), _jsx("span", { className: "text-sm text-gray-600 ml-2", children: "(Grade A-)" })] })] }) })] }), _jsx("div", { className: "flex gap-4", children: _jsx("button", { className: "flex-1 px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold", children: "Export Health Report" }) })] }))] })] }));
};
export default CFOServices;
