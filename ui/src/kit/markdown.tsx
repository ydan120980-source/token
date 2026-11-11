import { Fragment, memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CopyButton } from "./extended-controls";
import { codeTokens } from "./code-tokens";

// Markdown as the Agents write it (SESSIONS-READER-20261101.md), rendered to elements: never parsed as HTML.
// An http(s) link, written as one or bare, is opened through onLink when clicked (the address in its title);
// without onLink it stays text. Only images carried in the record itself (a data URL of a raster type) are
// shown; any other image reads as its alt text. A find phrase is marked in every text run.
type Block =
  | { kind: "code"; lang: string; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "rule" }
  | { kind: "paragraph"; text: string };

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/, HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/, RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/, BULLET = /^\s{0,3}([-*+]|\d{1,9}[.)])\s+/, DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const starts = (line: string, next: string | undefined) => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || BULLET.test(line) || (line.includes("|") && next !== undefined && DIVIDER.test(next));
const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n"), blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i], fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = []; i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) body.push(lines[i++]);
      i++; blocks.push({ kind: "code", lang: fence[2], text: body.join("\n") }); continue;
    }
    if (!line.trim()) { i++; continue; }
    const heading = HEADING.exec(line);
    if (heading) { blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] }); i++; continue; }
    if (RULE.test(line)) { blocks.push({ kind: "rule" }); i++; continue; }
    if (QUOTE.test(line)) { const quote: string[] = []; while (i < lines.length && QUOTE.test(lines[i])) quote.push(lines[i++].replace(QUOTE, "")); blocks.push({ kind: "quote", text: quote.join("\n") }); continue; }
    if (BULLET.test(line)) {
      const ordered = /^\s{0,3}\d/.test(line), items: string[] = [];
      while (i < lines.length && (BULLET.test(lines[i]) || (items.length > 0 && /^\s{2,}\S/.test(lines[i])))) {
        if (BULLET.test(lines[i])) items.push(lines[i].replace(BULLET, "")); else items[items.length - 1] += "\n" + lines[i].trim();
        i++;
      }
      blocks.push({ kind: "list", ordered, start: ordered ? parseInt(line.trim(), 10) || 1 : 1, items }); continue;
    }
    if (line.includes("|") && i + 1 < lines.length && DIVIDER.test(lines[i + 1])) {
      const head = cells(line), rows: string[][] = []; i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push({ kind: "table", head, rows }); continue;
    }
    const paragraph: string[] = [line]; i++;
    while (i < lines.length && lines[i].trim() && !starts(lines[i], lines[i + 1])) paragraph.push(lines[i++]);
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

/** Text with every occurrence of query (lower case) marked; the current find result is marked strongest. */
export function Highlight({ text, query, current }: { text: string; query: string; current?: boolean }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase(), parts: ReactNode[] = [];
  let from = 0, at = lower.indexOf(query), n = 0;
  while (at >= 0 && n < 400) {
    parts.push(text.slice(from, at));
    parts.push(<mark key={"m" + n} data-find-mark data-find-current={current || undefined} className={"rounded-lg px-0.5 " + (current ? "bg-foreground text-background" : "bg-selected text-inherit")}>{text.slice(at, at + query.length)}</mark>);
    from = at + query.length; at = lower.indexOf(query, from); n++;
  }
  parts.push(text.slice(from));
  return <>{parts.map((part, index) => <Fragment key={index}>{part}</Fragment>)}</>;
}

const INLINE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*\*(?=\S)([\s\S]+?)\*\*|~~(?=\S)([\s\S]+?)~~|\*(?=[^\s*])([^*]+?)\*|(?<![\w])_(?=[^\s_])([^_]+?)_(?![\w])|(https?:\/\/[^\s<>()\[\]"'`]+[^\s<>()\[\]"'`.,;:!?。，；：！？）])/g;
type Link = ((url: string) => void) | undefined;
const WEB = /^https?:\/\//i;
function LinkText({ url, onLink, children }: { url: string; onLink: Link; children: ReactNode }) {
  return onLink && WEB.test(url) ? <button type="button" title={url} onClick={() => onLink(url)} data-md-link
    className="inline cursor-pointer rounded-lg text-left text-inherit underline underline-offset-4 outline-none hover:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring">{children}</button>
    : <span title={url} className="underline underline-offset-4">{children}</span>;
}
const RASTER = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
function inline(text: string, query: string, current: boolean | undefined, key = "", onLink?: Link): ReactNode[] {
  const out: ReactNode[] = []; let from = 0, n = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0, k = key + "." + n++;
    if (at > from) out.push(<Highlight key={k + "t"} text={text.slice(from, at)} query={query} current={current} />);
    if (match[1]) out.push(<code key={k} className="rounded-lg bg-surface-2 px-1 font-mono text-caption"><Highlight text={match[2]} query={query} current={current} /></code>);
    else if (match[4] !== undefined) out.push(RASTER.test(match[4]) ? <img key={k} src={match[4]} alt={match[3]} className="inline-block max-h-96 rounded-xl" /> : <span key={k} className="text-muted-foreground">{"[图片" + (match[3] ? " " + match[3] : "") + "]"}</span>);
    else if (match[5] !== undefined) out.push(<LinkText key={k} url={match[6]} onLink={onLink}>{inline(match[5], query, current, k)}</LinkText>);
    else if (match[7] !== undefined) out.push(<strong key={k} className="font-semibold">{inline(match[7], query, current, k, onLink)}</strong>);
    else if (match[8] !== undefined) out.push(<s key={k}>{inline(match[8], query, current, k, onLink)}</s>);
    else if (match[11] !== undefined) out.push(<LinkText key={k} url={match[11]} onLink={onLink}><Highlight text={match[11]} query={query} current={current} /></LinkText>);
    else out.push(<em key={k}>{inline(match[9] ?? match[10] ?? "", query, current, k, onLink)}</em>);
    from = at + match[0].length;
  }
  if (from < text.length) out.push(<Highlight key={key + "end"} text={text.slice(from)} query={query} current={current} />);
  return out;
}

// Code keeps its colours off while a find marks it, and past this size. Only blocks near the view are coloured and a
// block far away goes back to plain text: colouring every block of a 300-turn session measured 118 MB of renderer
// memory (docs/m2/UI-READER-PARSING-20261102.md). The text is the same either way, so nothing moves.
const COLOUR_LIMIT = 64 * 1024;
const TOKEN_CLASS = { keyword: "ff-code-keyword", string: "ff-code-string", comment: "ff-code-comment", number: "ff-code-number" } as const;
function CodeText({ text, lang, query, current }: { text: string; lang: string; query: string; current?: boolean }) {
  const box = useRef<HTMLSpanElement>(null), [near, setNear] = useState(false);
  useEffect(() => {
    const element = box.current; if (!element || query || !lang || text.length > COLOUR_LIMIT) return;
    const observer = new IntersectionObserver(entries => setNear(entries.some(entry => entry.isIntersecting)), { rootMargin: "400px 0px" });
    observer.observe(element); return () => observer.disconnect();
  }, [text, lang, query]);
  const tokens = useMemo(() => near && !query ? codeTokens(text, lang) : null, [near, text, lang, query]);
  return <span ref={box}>{tokens ? tokens.map((token, index) => token.kind ? <span key={index} className={TOKEN_CLASS[token.kind]} data-code-token={token.kind}>{token.text}</span> : <Fragment key={index}>{token.text}</Fragment>) : <Highlight text={text} query={query} current={current} />}</span>;
}
function BlockView({ block, query, current, onLink, onCopyCode }: { block: Block; query: string; current?: boolean; onLink?: Link; onCopyCode?: (text: string) => Promise<boolean> }) {
  switch (block.kind) {
    case "code": return <div className="flex min-w-0 flex-col gap-1" data-md-code>
      {block.lang || onCopyCode ? <span className="flex min-h-7 items-center justify-between gap-2 pl-4">
        <span className="text-micro text-muted-foreground">{block.lang}</span>
        {onCopyCode ? <CopyButton size="compact" label="复制代码" onCopy={() => onCopyCode(block.text)} /> : null}
      </span> : null}
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-surface-2 p-4 font-mono text-caption text-foreground"><CodeText text={block.text} lang={block.lang} query={query} current={current} /></pre>
    </div>;
    case "heading": return <p className={(block.level <= 2 ? "text-subtitle" : "text-body") + " font-semibold text-foreground"} role="heading" aria-level={block.level}>{inline(block.text, query, current, "", onLink)}</p>;
    case "quote": return <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-muted-foreground">{inline(block.text, query, current, "", onLink)}</blockquote>;
    case "rule": return <hr className="border-border" />;
    case "list": {
      const items = block.items.map((item, index) => <li key={index} className="whitespace-pre-wrap break-words pl-1">{inline(item, query, current, "l" + index, onLink)}</li>);
      return block.ordered ? <ol start={block.start} className="flex list-decimal flex-col gap-1 pl-6">{items}</ol> : <ul className="flex list-disc flex-col gap-1 pl-6">{items}</ul>;
    }
    case "table": return <div className="max-w-full overflow-x-auto" data-md-table>
      <table className="text-caption">
        <thead><tr>{block.head.map((cell, index) => <th key={index} className="border-b border-border px-2 py-1 text-left font-medium text-foreground">{inline(cell, query, current, "", onLink)}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, at) => <tr key={at}>{row.map((cell, index) => <td key={index} className="border-b border-border px-2 py-1 align-top">{inline(cell, query, current, "", onLink)}</td>)}</tr>)}</tbody>
      </table>
    </div>;
    default: return <p className="whitespace-pre-wrap break-words">{inline(block.text, query, current, "", onLink)}</p>;
  }
}

/** A message's text as Markdown; query (lower case) marks the find phrase, current marks it as the current result;
 * onLink opens an http(s) link the person clicks. */
export const Markdown = memo(function Markdown({ text, query = "", current, onLink, onCopyCode }: { text: string; query?: string; current?: boolean; onLink?: (url: string) => void; onCopyCode?: (text: string) => Promise<boolean> }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className="flex min-w-0 flex-col gap-3 text-body text-foreground" data-markdown>
    {blocks.map((block, index) => <BlockView key={index} block={block} query={query} current={current} onLink={onLink} onCopyCode={onCopyCode} />)}
  </div>;
});
