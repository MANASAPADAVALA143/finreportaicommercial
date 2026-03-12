import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
const NoteTemplate = ({ noteNumber, noteTitle, autoContent, customContent, onSave, }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState(customContent ?? autoContent);
    const displayContent = customContent ?? autoContent;
    const handleSave = () => {
        onSave(editContent);
        setIsEditing(false);
    };
    const handleReset = () => {
        setEditContent(autoContent);
        onSave('');
        setIsEditing(false);
    };
    return (_jsxs("div", { className: "max-w-4xl mx-auto p-8 font-serif print:max-w-none", children: [_jsxs("div", { className: "mb-6", children: [_jsxs("h3", { className: "text-base font-bold text-gray-900", children: ["NOTE ", noteNumber, " \u2013 ", noteTitle.toUpperCase()] }), _jsx("hr", { className: "mt-2 border-gray-900" })] }), _jsxs("div", { className: "flex gap-2 mb-4 print:hidden", children: [!isEditing ? (_jsx("button", { type: "button", onClick: () => setIsEditing(true), className: "text-xs px-3 py-1.5 border border-blue-600 text-blue-600 rounded hover:bg-blue-50", children: "Customise Note" })) : (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", onClick: handleSave, className: "text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700", children: "Save Changes" }), _jsx("button", { type: "button", onClick: handleReset, className: "text-xs px-3 py-1.5 border border-gray-300 text-gray-600 rounded hover:bg-gray-50", children: "Reset to AI Version" })] })), customContent && !isEditing && (_jsx("span", { className: "text-xs text-green-600 flex items-center gap-1", children: "Customised" }))] }), isEditing ? (_jsx("textarea", { value: editContent, onChange: (e) => setEditContent(e.target.value), className: "w-full min-h-48 p-3 text-sm border border-blue-300 rounded font-serif leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500" })) : (_jsx("div", { className: "text-sm leading-relaxed text-gray-800 font-serif whitespace-pre-line", dangerouslySetInnerHTML: {
                    __html: displayContent
                        ? displayContent.replace(/\n/g, '<br />')
                        : '<p class="text-gray-500">No content yet. Generate statements to auto-fill this note.</p>',
                } }))] }));
};
export default NoteTemplate;
