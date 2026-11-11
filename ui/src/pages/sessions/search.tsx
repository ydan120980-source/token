import { useEffect, useRef, useState } from "react";
import { AgentMark, Button, EmptyState, ResultRow } from "@ui/kit";
import { useSessionsHost, type Session, type TranscriptSearch, type TranscriptSnippet } from "@ui/data";

// Search across conversations (SESSIONS-READER-20261101.md, step 3): the sessions in the page's range
// and Agent filter, newest first. Each batch scans their files for a few seconds and the person
// continues when more are left; nothing is indexed or kept. A result opens the reading view on the phrase.
const KIND: Record<TranscriptSnippet["kind"], string> = { user: "你", assistant: "回复", thinking: "思考", tool: "工具", context: "上下文", command: "命令", image: "图片", compact: "压缩" };
type Found = TranscriptSearch["results"][number];
type Run = { state: "loading" | "ready" | "error"; found: Found[]; searched: number; total: number; next: number | null };

function when(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : (date.getMonth() + 1) + " 月 " + date.getDate() + " 日 " + String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
}

export function ContentSearch({ phrase, range, agent, rangeLabel, sessions, onClose }: { phrase: string; range: string; agent: string; rangeLabel: string; sessions: Session[]; onClose: () => void }) {
  const host = useSessionsHost(), labels = host.labels(), [run, setRun] = useState<Run>({ state: "loading", found: [], searched: 0, total: 0, next: 0 });
  const seq = useRef(0);
  const batch = (offset: number, previous: Found[]) => {
    const id = ++seq.current;
    setRun(current => ({ ...current, state: "loading", found: previous }));
    host.search({ query: phrase, range, agent, offset })
      .then(value => { if (id === seq.current) setRun({ state: "ready", found: [...previous, ...value.results], searched: value.searched, total: value.total, next: value.next }); })
      .catch(() => { if (id === seq.current) setRun(current => ({ ...current, state: "error" })); });
  };
  useEffect(() => { batch(0, []); return () => { seq.current++; }; }, [phrase, range, agent]);
  const byKey = new Map(sessions.map(session => [session.key, session]));
  const rows = run.found.flatMap(result => { const session = byKey.get(result.key); return session ? [{ result, session }] : []; });
  const more = run.next !== null && run.state !== "loading";
  const status = run.state === "error" ? "搜索失败，稍后再试。"
    : (run.state === "loading" && !run.searched ? "正在搜索…" : rows.length + " 个会话有“" + phrase + "”") + (run.total ? " · 已搜 " + run.searched + " / " + run.total + " 个会话" : "");
  return <div className="flex flex-col gap-3" data-content-search>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-caption text-muted-foreground" role="status" aria-live="polite" data-content-search-status>{rangeLabel + " · " + status}</p>
      <div className="flex items-center gap-2">
        {more ? <Button variant="secondary" size="compact" onClick={() => batch(run.next!, run.found)}>{"继续搜索更早的会话"}</Button> : null}
        <Button variant="tertiary" size="compact" onClick={onClose}>{"返回会话列表"}</Button>
      </div>
    </div>
    {rows.length ? <ul className="flex flex-col" aria-label={"包含“" + phrase + "”的会话"} data-content-results>
      {rows.map(({ result, session }) => {
        const name = labels[session.key]?.alias || session.title || session.project || "未知项目";
        return <li key={result.key} data-content-result>
          <ResultRow lead={<AgentMark agent={session.agent} variant="icon" size={16} />} title={name} meta={when(session.start)} aside={result.hits + " 处"}
            lines={result.snippets.map((snippet, index) => ({ key: String(index), label: KIND[snippet.kind], before: snippet.before, match: snippet.match, after: snippet.after }))}
            onClick={() => host.read({ ...session, name, find: phrase })} aria-label={name + "，" + when(session.start) + "，" + result.hits + " 处"} />
        </li>;
      })}
    </ul> : run.state === "ready" ? <EmptyState message={"没有找到“" + phrase + "”。"} /> : null}
  </div>;
}
