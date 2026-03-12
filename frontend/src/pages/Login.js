import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../services/auth';
import { LogIn } from 'lucide-react';
import toast from 'react-hot-toast';
export const Login = () => {
    const navigate = useNavigate();
    const { login, error, clearError } = useAuthStore();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        clearError();
        try {
            await login(email, password);
            toast.success('Login successful!');
            navigate('/dashboard');
        }
        catch (error) {
            toast.error(error.response?.data?.detail || 'Login failed');
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsx("div", { className: "min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4", children: _jsxs("div", { className: "bg-white rounded-xl shadow-2xl w-full max-w-md p-8", children: [_jsxs("div", { className: "text-center mb-8", children: [_jsx("div", { className: "inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4", children: _jsx(LogIn, { className: "w-8 h-8 text-blue-600" }) }), _jsx("h1", { className: "text-3xl font-bold text-gray-900", children: "Welcome Back" }), _jsx("p", { className: "text-gray-600 mt-2", children: "Sign in to your FinReport AI account" })] }), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Email Address" }), _jsx("input", { type: "email", value: email, onChange: (e) => setEmail(e.target.value), className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", placeholder: "you@company.com", required: true })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Password" }), _jsx("input", { type: "password", value: password, onChange: (e) => setPassword(e.target.value), className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", required: true })] }), error && (_jsx("div", { className: "bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm", children: error })), _jsx("button", { type: "submit", disabled: loading, className: "w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed", children: loading ? 'Signing in...' : 'Sign In' })] }), _jsxs("div", { className: "mt-6 text-center text-sm text-gray-600", children: ["Don't have an account?", ' ', _jsx(Link, { to: "/register", className: "text-blue-600 font-semibold hover:text-blue-700", children: "Sign up" })] })] }) }));
};
