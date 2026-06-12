"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/* Markdown rendered in the boutique-terminal style: tight spacing, hairline
   borders, accent links, mono for code/tables. Used for advisor replies. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md text-[0.86rem] leading-relaxed text-[var(--color-ink-soft)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-[1.02rem] font-semibold text-[var(--color-ink)] mt-4 mb-2 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-[0.95rem] font-semibold text-[var(--color-ink)] mt-4 mb-1.5 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[0.88rem] font-semibold text-[var(--color-ink)] mt-3 mb-1 first:mt-0">
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-semibold text-[var(--color-ink)]">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="link-accent underline underline-offset-2">
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="my-2 pl-4 space-y-1 list-disc marker:text-[var(--color-dim)]">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 pl-4 space-y-1 list-decimal marker:text-[var(--color-dim)]">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 pl-3 border-l-2 border-[var(--color-accent)] text-[var(--color-muted)]">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-[var(--color-line)]" />,
          code: ({ className, children }) => {
            const block = (className ?? "").includes("language-");
            if (block) {
              return (
                <code className="block tnum text-[0.8rem] text-[var(--color-ink-soft)]">{children}</code>
              );
            }
            return (
              <code
                className="rounded px-1 py-0.5 text-[0.8rem]"
                style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-line)", fontFamily: "var(--font-mono)" }}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-md p-3" style={{ background: "var(--color-canvas)", border: "1px solid var(--color-line)" }}>
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-2.5 overflow-x-auto rounded-md border border-[var(--color-line)]">
              <table className="w-full border-collapse text-[0.82rem]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead>{children}</thead>,
          th: ({ children }) => (
            <th className="text-left font-semibold text-[var(--color-dim)] uppercase tracking-wider text-[0.66rem] px-3 py-2 border-b border-[var(--color-line)] bg-[var(--color-surface-2)]">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 border-b border-[var(--color-line)] align-top text-[var(--color-ink-soft)]">
              {children}
            </td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
