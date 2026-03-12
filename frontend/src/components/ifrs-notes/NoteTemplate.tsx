import React, { useState } from 'react';

export interface NoteTemplateProps {
  noteId: string;
  noteNumber: number;
  noteTitle: string;
  autoContent: string;
  customContent?: string;
  onSave: (content: string) => void;
}

const NoteTemplate: React.FC<NoteTemplateProps> = ({
  noteNumber,
  noteTitle,
  autoContent,
  customContent,
  onSave,
}) => {
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

  return (
    <div className="max-w-4xl mx-auto p-8 font-serif print:max-w-none">
      <div className="mb-6">
        <h3 className="text-base font-bold text-gray-900">
          NOTE {noteNumber} – {noteTitle.toUpperCase()}
        </h3>
        <hr className="mt-2 border-gray-900" />
      </div>

      <div className="flex gap-2 mb-4 print:hidden">
        {!isEditing ? (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="text-xs px-3 py-1.5 border border-blue-600 text-blue-600 rounded hover:bg-blue-50"
          >
            Customise Note
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleSave}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Save Changes
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs px-3 py-1.5 border border-gray-300 text-gray-600 rounded hover:bg-gray-50"
            >
              Reset to AI Version
            </button>
          </>
        )}
        {customContent && !isEditing && (
          <span className="text-xs text-green-600 flex items-center gap-1">
            Customised
          </span>
        )}
      </div>

      {isEditing ? (
        <textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          className="w-full min-h-48 p-3 text-sm border border-blue-300 rounded font-serif leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      ) : (
        <div
          className="text-sm leading-relaxed text-gray-800 font-serif whitespace-pre-line"
          dangerouslySetInnerHTML={{
            __html: displayContent
              ? displayContent.replace(/\n/g, '<br />')
              : '<p class="text-gray-500">No content yet. Generate statements to auto-fill this note.</p>',
          }}
        />
      )}
    </div>
  );
};

export default NoteTemplate;
