// Colours for code in the reading view, without a parser or a dependency: comments, strings, numbers and each
// language family's keywords. It colours and never reflows: text that fits no rule stays plain.
export type CodeToken = { text: string; kind: "keyword" | "string" | "comment" | "number" | null };

const words = (text: string) => new Set(text.split(" "));
const C = "if else for while do switch case break continue return function class new delete try catch finally throw typeof instanceof in of var let const this super import export from default extends implements interface enum type public private protected static async await yield void null true false undefined";
const FAMILIES: Record<string, { line?: string; block?: boolean; keywords: Set<string> }> = {
  c: { line: "//", block: true, keywords: words(C + " struct fn impl pub use mod match mut self trait where func package go defer chan map range var nil int long float double char bool string auto sizeof") },
  py: { line: "#", keywords: words("def class if elif else for while try except finally with as return import from yield lambda pass break continue raise global nonlocal in is not and or None True False async await self") },
  sh: { line: "#", keywords: words("if then else elif fi for while do done case esac function in return exit export local set cd echo sudo npm node git") },
  ps: { line: "#", keywords: words("function if else elseif foreach while do switch try catch finally return param begin process end throw") },
  json: { keywords: words("true false null") },
  sql: { line: "--", keywords: words("select from where join left right inner outer on group by order having insert into values update set delete create table index and or not null as limit") },
  css: { block: true, keywords: words("important") },
  yaml: { line: "#", keywords: words("true false null") },
};
const LANGUAGES: Record<string, string> = {
  js: "c", jsx: "c", ts: "c", tsx: "c", mjs: "c", cjs: "c", javascript: "c", typescript: "c", java: "c", c: "c", cpp: "c", "c++": "c", cs: "c", csharp: "c", go: "c", rust: "c", rs: "c", swift: "c", kotlin: "c", php: "c",
  py: "py", python: "py", rb: "py", ruby: "py", sh: "sh", bash: "sh", shell: "sh", zsh: "sh", ps1: "ps", powershell: "ps", pwsh: "ps",
  json: "json", jsonc: "json", sql: "sql", css: "css", scss: "css", less: "css", yaml: "yaml", yml: "yaml", toml: "yaml",
};
/** Tokens for a known language, or null: an unknown language is left plain rather than guessed. */
export function codeTokens(text: string, lang: string): CodeToken[] | null {
  const family = FAMILIES[LANGUAGES[lang.toLowerCase()] ?? ""]; if (!family) return null;
  const out: CodeToken[] = []; let plain = "", at = 0;
  const flush = () => { if (plain) out.push({ text: plain, kind: null }); plain = ""; };
  const push = (end: number, kind: CodeToken["kind"]) => { flush(); out.push({ text: text.slice(at, end), kind }); at = end; };
  while (at < text.length) {
    const ch = text[at];
    if (family.line && text.startsWith(family.line, at)) { const end = text.indexOf("\n", at); push(end < 0 ? text.length : end, "comment"); continue; }
    if (family.block && text.startsWith("/*", at)) { const end = text.indexOf("*/", at + 2); push(end < 0 ? text.length : end + 2, "comment"); continue; }
    if (ch === '"' || ch === "'" || ch === String.fromCharCode(96)) {
      let end = at + 1;
      while (end < text.length && text[end] !== ch && (ch === String.fromCharCode(96) || text[end] !== "\n")) end += text[end] === "\\" ? 2 : 1;
      push(Math.min(text.length, end + 1), "string"); continue;
    }
    if (/[0-9]/.test(ch) && !/[\w$]/.test(text[at - 1] ?? "")) { let end = at; while (end < text.length && /[\w.]/.test(text[end])) end++; push(end, "number"); continue; }
    if (/[A-Za-z_$]/.test(ch)) {
      let end = at; while (end < text.length && /[\w$]/.test(text[end])) end++;
      const word = text.slice(at, end);
      if (family.keywords.has(word) || (LANGUAGES[lang.toLowerCase()] === "sql" && family.keywords.has(word.toLowerCase()))) push(end, "keyword");
      else { plain += word; at = end; }
      continue;
    }
    plain += ch; at++;
  }
  flush();
  return out;
}
