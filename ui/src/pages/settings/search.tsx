import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { SectionHeader } from "@ui/kit";
import type { SettingsSection as SectionName } from "@ui/data";

// Settings search, as on the legacy page: a block matches when its section heading or its own
// text contains the query (trimmed, lower case); a section without a matching block is hidden.
// Matching reads the page's own rendered text, so model names in the pricing table count too.
const PageSearch = createContext<{ query: string; current: SectionName | null; report: (section: SectionName, visible: boolean) => void }>({ query: "", current: null, report: () => {} });
const SectionSearch = createContext<{ query: string; headMatch: boolean; report: (block: string, match: boolean | null) => void }>({ query: "", headMatch: false, report: () => {} });

export function SearchProvider({ query, current, onVisibility, children }: { query: string; current: SectionName; onVisibility: (section: SectionName, visible: boolean) => void; children: ReactNode }) {
  return <PageSearch.Provider value={{ query: query.trim().toLowerCase(), current, report: onVisibility }}>{children}</PageSearch.Provider>;
}

export function Section({ name, title, children }: { name: SectionName; title: string; children: ReactNode }) {
  const { query, current, report } = useContext(PageSearch);
  const [blocks, setBlocks] = useState<Record<string, boolean>>({});
  const headMatch = Boolean(query) && title.toLowerCase().includes(query);
  // null withdraws a block that unmounted, so a replaced block never keeps its section visible.
  const reportBlock = useCallback((block: string, match: boolean | null) => setBlocks(current => {
    if (match === null) { if (!(block in current)) return current; const next = { ...current }; delete next[block]; return next; }
    return current[block] === match ? current : { ...current, [block]: match };
  }), []);
  const visible = !query || Object.values(blocks).some(Boolean);
  useEffect(() => { report(name, visible); }, [name, visible, report]);
  return <section id={"section-" + name} data-section={name} aria-label={title} hidden={!visible || (!query && current !== name)} className="flex scroll-mt-6 flex-col gap-3">
    <SectionHeader title={title} />
    <SectionSearch.Provider value={{ query, headMatch, report: reportBlock }}>{children}</SectionSearch.Provider>
  </section>;
}

// keywords: text a control holds only while it is open (select options), searched like the legacy
// page searched its native <select> options.
export function Block({ keywords = "", children }: { keywords?: string; children: ReactNode }) {
  const { query, headMatch, report } = useContext(SectionSearch), id = useId(), ref = useRef<HTMLDivElement>(null);
  const [match, setMatch] = useState(true);
  useLayoutEffect(() => {
    const element = ref.current;
    const check = () => { const next = !query || headMatch || ((element?.textContent ?? "") + " " + keywords).toLowerCase().includes(query); setMatch(next); report(id, next); };
    check();
    if (!query || !element) return;
    const observer = new MutationObserver(check);
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [query, headMatch, keywords, report, id]);
  useEffect(() => () => report(id, null), [report, id]);
  return <div ref={ref} hidden={!match} data-search-block>{children}</div>;
}
