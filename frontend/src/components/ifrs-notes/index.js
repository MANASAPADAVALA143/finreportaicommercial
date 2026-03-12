import { jsx as _jsx } from "react/jsx-runtime";
import NoteTemplate from './NoteTemplate';
const NOTE_CONFIG = {
    'note-1-general': { number: 1, title: 'General Information' },
    'note-2-policies': { number: 2, title: 'Significant Accounting Policies' },
    'note-3-revenue': { number: 3, title: 'Revenue (IFRS 15)' },
    'note-4-ppe': { number: 4, title: 'Property, Plant & Equipment' },
    'note-5-leases': { number: 5, title: 'Leases (IFRS 16)' },
    'note-6-instruments': { number: 6, title: 'Financial Instruments' },
    'note-7-inventory': { number: 7, title: 'Inventories' },
    'note-8-tax': { number: 8, title: 'Income Tax' },
    'note-9-related': { number: 9, title: 'Related Party Transactions' },
    'note-10-events': { number: 10, title: 'Subsequent Events' },
};
export const IFRSNoteView = ({ sectionId, noteNumber, noteTitle, autoContent, customContent, onSave, }) => (_jsx(NoteTemplate, { noteId: sectionId, noteNumber: noteNumber, noteTitle: noteTitle, autoContent: autoContent, customContent: customContent, onSave: onSave }));
export { default as NoteTemplate } from './NoteTemplate';
export { NOTE_CONFIG };
