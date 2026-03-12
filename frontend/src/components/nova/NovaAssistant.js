import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Bot, Send, Loader } from 'lucide-react';
import { api } from '../../services/api';
import toast from 'react-hot-toast';
export const NovaAssistant = () => {
    const [messages, setMessages] = useState([
        {
            role: 'assistant',
            content: 'Hello! I\'m your Amazon Nova AI financial assistant. I can help you with financial analysis, forecasting, compliance checks, and more. How can I assist you today?'
        }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!input.trim() || loading)
            return;
        const userMessage = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
        setLoading(true);
        try {
            const response = await api.analyzeWithNova(userMessage);
            setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: response.response,
                    confidence: response.confidence
                }]);
        }
        catch (error) {
            toast.error('Failed to get response from Nova');
            setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: 'I apologize, but I encountered an error processing your request. Please try again.'
                }]);
        }
        finally {
            setLoading(false);
        }
    };
    const quickPrompts = [
        'Analyze my recent journal entries for anomalies',
        'Generate a financial forecast for next quarter',
        'Check IFRS compliance for my latest reports',
        'Calculate key financial ratios',
        'Identify cost-saving opportunities'
    ];
    return (_jsx("div", { className: "min-h-screen bg-gray-50 p-8", children: _jsxs("div", { className: "container mx-auto max-w-4xl", children: [_jsx("div", { className: "bg-gradient-to-r from-cyan-500 to-blue-600 rounded-lg p-6 mb-6 text-white", children: _jsxs("div", { className: "flex items-center gap-4", children: [_jsx(Bot, { className: "w-12 h-12" }), _jsxs("div", { children: [_jsx("h1", { className: "text-3xl font-bold", children: "Amazon Nova AI Assistant" }), _jsx("p", { className: "text-cyan-100", children: "Your intelligent financial advisor powered by AWS" })] })] }) }), _jsxs("div", { className: "bg-white rounded-lg shadow-lg h-[600px] flex flex-col", children: [_jsxs("div", { className: "flex-1 overflow-y-auto p-6 space-y-4", children: [messages.map((message, index) => (_jsx("div", { className: `flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`, children: _jsxs("div", { className: `max-w-[80%] rounded-lg p-4 ${message.role === 'user'
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-gray-100 text-gray-900'}`, children: [_jsx("p", { className: "whitespace-pre-wrap", children: message.content }), message.confidence && (_jsxs("div", { className: "mt-2 text-xs opacity-75", children: ["Confidence: ", (message.confidence * 100).toFixed(0), "%"] }))] }) }, index))), loading && (_jsx("div", { className: "flex justify-start", children: _jsx("div", { className: "bg-gray-100 rounded-lg p-4", children: _jsx(Loader, { className: "w-6 h-6 animate-spin text-blue-600" }) }) }))] }), _jsx("div", { className: "px-6 py-3 border-t border-gray-200", children: _jsx("div", { className: "flex flex-wrap gap-2", children: quickPrompts.map((prompt, index) => (_jsx("button", { onClick: () => {
                                        setInput(prompt);
                                    }, className: "px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition", children: prompt }, index))) }) }), _jsx("div", { className: "p-6 border-t border-gray-200", children: _jsxs("form", { onSubmit: handleSubmit, className: "flex gap-4", children: [_jsx("input", { type: "text", value: input, onChange: (e) => setInput(e.target.value), placeholder: "Ask me anything about your finances...", className: "flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", disabled: loading }), _jsxs("button", { type: "submit", disabled: loading || !input.trim(), className: "px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2", children: [_jsx(Send, { className: "w-5 h-5" }), "Send"] })] }) })] })] }) }));
};
