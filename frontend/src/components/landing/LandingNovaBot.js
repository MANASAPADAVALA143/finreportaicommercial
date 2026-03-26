import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Loader2 } from 'lucide-react';
const API_BASE = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || '';
const INVOKE_URL = `${API_BASE.replace(/\/$/, '')}/api/ai/invoke`;
const SYSTEM_PROMPT = `You are a helpful assistant for FinReportAI Commercial, an AI finance platform. Answer in 2-3 sentences max. Be clear and non-technical.`;
const SUGGESTED_QUESTIONS = [
    'What does FinReportAI detect?',
    'How does anomaly scoring work?',
    'What is the CFO health score?',
];
export const LandingNovaBot = () => {
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const panelRef = useRef(null);
    useEffect(() => {
        if (open && panelRef.current) {
            panelRef.current.scrollTop = panelRef.current.scrollHeight;
        }
    }, [open, messages]);
    const sendMessage = async (text) => {
        const trimmed = text.trim();
        if (!trimmed || loading)
            return;
        setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
        setInput('');
        setLoading(true);
        try {
            const prompt = `${SYSTEM_PROMPT}\n\nUser question: ${trimmed}`;
            const res = await fetch(INVOKE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model_id: '',
                    prompt,
                    max_tokens: 300,
                    temperature: 0.3,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail ?? `Request failed: ${res.status}`);
            }
            const data = (await res.json());
            const reply = (data.text ?? '').trim() || 'No response.';
            setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setMessages((prev) => [...prev, { role: 'assistant', text: `Sorry, I couldn’t reach the assistant. (${msg})` }]);
        }
        finally {
            setLoading(false);
        }
    };
    const handleSubmit = (e) => {
        e.preventDefault();
        sendMessage(input);
    };
    return (_jsxs(_Fragment, { children: [_jsxs("button", { type: "button", onClick: () => setOpen((o) => !o), className: "fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all font-medium", "aria-label": "Ask Nova", children: [_jsx(MessageCircle, { className: "w-5 h-5" }), "Ask AI"] }), open && (_jsxs("div", { className: "fixed bottom-24 right-6 z-50 w-[300px] h-[400px] flex flex-col bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden", style: { maxHeight: 'calc(100vh - 120px)' }, children: [_jsxs("div", { className: "flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white", children: [_jsx("span", { className: "font-semibold", children: "AI Assistant" }), _jsx("button", { type: "button", onClick: () => setOpen(false), className: "p-1 hover:bg-white/20 rounded", "aria-label": "Close", children: _jsx(X, { className: "w-5 h-5" }) })] }), _jsxs("div", { ref: panelRef, className: "flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50", children: [messages.length === 0 && (_jsxs("div", { className: "space-y-2", children: [_jsx("p", { className: "text-sm text-slate-600", children: "Try a quick question:" }), SUGGESTED_QUESTIONS.map((q) => (_jsx("button", { type: "button", onClick: () => sendMessage(q), className: "block w-full text-left px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg hover:bg-blue-50 hover:border-blue-200 transition", children: q }, q)))] })), messages.map((m, i) => (_jsx("div", { className: `flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`, children: _jsxs("div", { className: `max-w-[85%] px-3 py-2 rounded-lg text-sm ${m.role === 'user'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-white border border-slate-200'}`, children: [m.role === 'assistant' && (_jsx("p", { className: "text-xs font-semibold text-blue-600 mb-1", children: "Assistant \u2726" })), _jsx("p", { className: "whitespace-pre-wrap", children: m.text })] }) }, i))), loading && (_jsx("div", { className: "flex justify-start", children: _jsxs("div", { className: "px-3 py-2 rounded-lg bg-white border border-slate-200 flex items-center gap-2 text-sm text-slate-600", children: [_jsx(Loader2, { className: "w-4 h-4 animate-spin" }), _jsx("span", { children: "Thinking..." })] }) }))] }), _jsx("form", { onSubmit: handleSubmit, className: "p-2 border-t border-slate-200 bg-white", children: _jsxs("div", { className: "flex gap-2", children: [_jsx("input", { type: "text", value: input, onChange: (e) => setInput(e.target.value), placeholder: "Ask anything...", className: "flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none", disabled: loading }), _jsx("button", { type: "submit", disabled: loading || !input.trim(), className: "p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed", "aria-label": "Send", children: _jsx(Send, { className: "w-4 h-4" }) })] }) })] }))] }));
};
