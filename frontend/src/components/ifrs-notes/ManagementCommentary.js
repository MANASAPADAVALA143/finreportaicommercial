import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const ManagementCommentary = ({ data, entityName = '', periodEnd = '', }) => {
    return (_jsxs("div", { className: "max-w-4xl mx-auto p-8 font-serif", children: [_jsxs("div", { className: "mb-6", children: [_jsx("h3", { className: "text-lg font-bold text-gray-900", children: "Management Commentary & Analysis" }), _jsxs("p", { className: "text-sm text-gray-600 mt-1", children: [entityName, " \u2014 Period ended ", periodEnd] }), _jsx("hr", { className: "mt-2 border-gray-900" })] }), _jsx("div", { className: "text-sm leading-relaxed text-gray-800 whitespace-pre-line", dangerouslySetInnerHTML: {
                    __html: data
                        ? data.replace(/\n/g, '<br />')
                        : '<p class="text-gray-500">Generate statements to see AI financial commentary here.</p>',
                } })] }));
};
export default ManagementCommentary;
