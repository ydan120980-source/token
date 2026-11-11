import { memo, useMemo } from "react";
import { Highlight } from "./markdown";

// A change as lines: "*** path" before each file, "@@" for a place in it, then lines added, removed and kept.
// The tints say which side of the change a line is on, not whether it is good.
export const DiffBlock = memo(function DiffBlock({ text, query = "", current }: { text: string; query?: string; current?: boolean }) {
  const lines = useMemo(() => text.split("\n"), [text]);
  return <div className="max-h-96 overflow-auto rounded-xl bg-surface-2 py-2 font-mono text-caption text-foreground" data-diff>
    <div className="inline-block min-w-full">{lines.map((line, index) => {
      if (line.startsWith("*** ")) return <div key={index} className="truncate px-4 pb-1 pt-2 font-sans font-medium text-muted-foreground" data-diff-file title={line.slice(4)}>{line.slice(4)}</div>;
      const mark = line[0], kind = mark === "+" ? "ff-diff-add" : mark === "-" ? "ff-diff-del" : line.startsWith("@@") ? "text-muted-foreground" : "";
      return <div key={index} className={"whitespace-pre px-4 " + kind} data-diff-line={mark === "+" ? "add" : mark === "-" ? "del" : undefined}><Highlight text={line.length ? line : " "} query={query} current={current} /></div>;
    })}</div>
  </div>;
});
