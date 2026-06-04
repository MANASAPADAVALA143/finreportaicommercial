import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Partial<Components> = {
  table: ({ children }) => (
    <div className="my-2 max-w-full overflow-x-auto rounded-md border border-gray-200 bg-white">
      <table className="min-w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  th: ({ children }) => (
    <th className="border-b border-gray-200 px-2.5 py-2 font-semibold text-gray-900 whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-gray-100 px-2.5 py-1.5 align-top text-gray-800">{children}</td>
  ),
  tr: ({ children }) => <tr className="odd:bg-white even:bg-gray-50/90">{children}</tr>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 text-sm">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 text-sm">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  p: ({ children }) => (
    <p className="my-2 text-sm leading-relaxed text-gray-800 first:mt-0 last:mb-0">{children}</p>
  ),
  h1: ({ children }) => (
    <h1 className="mb-2 mt-3 text-base font-semibold text-gray-900 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1.5 mt-3 text-sm font-semibold text-gray-900 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-gray-700">{children}</h3>
  ),
  hr: () => <hr className="my-3 border-gray-200" />,
  code: ({ className, children, ...props }) => {
    const inline = !className;
    if (inline) {
      return (
        <code
          className="rounded bg-gray-200/90 px-1 py-0.5 font-mono text-[11px] text-gray-900"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className="my-2 block max-h-48 overflow-x-auto overflow-y-auto rounded-md bg-gray-900 p-2 font-mono text-[11px] text-gray-100"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="my-2 max-w-full overflow-x-auto">{children}</pre>,
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-4 border-blue-200 bg-blue-50/50 py-1 pl-3 text-sm text-gray-800">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="font-medium text-blue-700 underline underline-offset-2 hover:text-blue-800"
      target="_blank"
      rel="noreferrer noopener"
    >
      {children}
    </a>
  ),
};

type Props = { content: string };

/** Renders assistant replies with GFM (tables, lists). Plain text errors stay readable. */
export function APChatMarkdown({ content }: Props) {
  if (content.startsWith('Error:')) {
    return <p className="whitespace-pre-wrap text-sm text-red-800">{content}</p>;
  }

  return (
    <div className="ap-chat-md text-sm text-gray-800">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
