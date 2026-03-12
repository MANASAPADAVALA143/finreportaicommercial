import React from 'react';

export interface ManagementCommentaryProps {
  data: string;
  entityName?: string;
  periodEnd?: string;
}

const ManagementCommentary: React.FC<ManagementCommentaryProps> = ({
  data,
  entityName = '',
  periodEnd = '',
}) => {
  return (
    <div className="max-w-4xl mx-auto p-8 font-serif">
      <div className="mb-6">
        <h3 className="text-lg font-bold text-gray-900">
          Management Commentary &amp; Analysis
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          {entityName} — Period ended {periodEnd}
        </p>
        <hr className="mt-2 border-gray-900" />
      </div>
      <div
        className="text-sm leading-relaxed text-gray-800 whitespace-pre-line"
        dangerouslySetInnerHTML={{
          __html: data
            ? data.replace(/\n/g, '<br />')
            : '<p class="text-gray-500">Generate statements to see AI financial commentary here.</p>',
        }}
      />
    </div>
  );
};

export default ManagementCommentary;
