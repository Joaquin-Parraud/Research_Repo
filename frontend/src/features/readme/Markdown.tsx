import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./Markdown.module.css";

/**
 * Renders Markdown. Raw HTML in the source is NOT rendered (react-markdown skips it
 * unless a raw-HTML plugin is added, which we never do); unsafe URLs are neutralised
 * by react-markdown's default URL transform.
 */
export function Markdown({ source }: { source: string }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
