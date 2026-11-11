import type { HTMLAttributes, ReactNode } from "react";
import { IconBraces, IconChevronRight, IconCode, IconFile, IconFileText, IconFileTypeCss, IconFileTypeHtml, IconFileTypeJs, IconFileTypeJsx, IconFileTypeSvg, IconFileTypeTs, IconFileTypeTsx, IconJson, IconLetterCase, IconMarkdown, IconPhoto, IconSquareDot, IconSquareMinus2, IconSquarePlus2, IconTerminal2 } from "@tabler/icons-react";
import type { IconComponent } from "@/lib/icon-context";

// The dense lists of the reading page's side columns, after Codex's session sidebar and change tree: one row that lights
// up when pointed at, shows its actions then, and hands the pointer back its figures when it leaves.

/** One row: an optional lead, a line that can carry a figure at its end, an optional line below, actions on pointing. */
export function SideRow({ lead, children, below, tail, actions, selected = false, onClick, level = 0, expanded, title, "aria-label": label, attributes, rowProps }: {
  lead?: ReactNode; children: ReactNode; below?: ReactNode; tail?: ReactNode; actions?: ReactNode; selected?: boolean; onClick?: () => void;
  /** Depth in a tree: one guide line per level. */ level?: number; expanded?: boolean; title?: string; "aria-label"?: string;
  /** On the row's own control. */ attributes?: Record<string, string | undefined>; /** On the row as a whole. */ rowProps?: HTMLAttributes<HTMLDivElement> & Record<string, unknown>;
}) {
  const inner = <>
    {Array.from({ length: level }, (_, at) => <span key={at} aria-hidden="true" className="ff-tree-guide" />)}
    {lead ? <span className="flex h-5 shrink-0 items-center">{lead}</span> : null}
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex min-h-5 min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1">{children}</span>
        {tail ? <span className="ff-side-tail flex shrink-0 items-center gap-1.5 tabular-nums text-muted-foreground">{tail}</span> : null}
      </span>
      {below}
    </span>
  </>;
  const shape = "flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-1.5 text-left text-caption text-foreground";
  return <div {...rowProps} className="ff-side-row relative flex min-w-0 items-center rounded-lg" data-selected={selected || undefined} data-has-actions={actions ? "" : undefined}>
    {onClick ? <button type="button" onClick={onClick} aria-current={selected ? "true" : undefined} aria-expanded={expanded} aria-label={label} title={title} className={shape + " outline-none focus-visible:ring-1 focus-visible:ring-ring"} {...attributes}>{inner}</button> :
      <div className={shape} title={title} {...attributes}>{inner}</div>}
    {actions ? <span className="ff-side-actions flex shrink-0 items-center gap-0.5">{actions}</span> : null}
  </div>;
}
/** The fold mark of a row that holds others. */
export function TreeChevron({ open }: { open: boolean }) {
  return <IconChevronRight size={14} aria-hidden="true" className="ff-tree-chevron shrink-0 text-muted-foreground" data-open={open || undefined} />;
}

const FILE_MARKS: [RegExp, IconComponent, string][] = [
  [/\.tsx$/i, IconFileTypeTsx, "ff-file-blue"], [/\.ts$/i, IconFileTypeTs, "ff-file-blue"],
  [/\.jsx$/i, IconFileTypeJsx, "ff-file-amber"], [/\.[cm]?js$/i, IconFileTypeJs, "ff-file-amber"],
  [/\.(css|scss|less)$/i, IconFileTypeCss, "ff-file-purple"], [/\.html?$/i, IconFileTypeHtml, "ff-file-orange"],
  [/\.svg$/i, IconFileTypeSvg, "ff-file-orange"], [/\.(png|jpe?g|gif|webp|ico|avif)$/i, IconPhoto, "ff-file-green"],
  [/\.(woff2?|ttf|otf)$/i, IconLetterCase, "ff-file-green"], [/\.jsonl?$/i, IconJson, "ff-file-amber"],
  [/\.(md|mdx|markdown)$/i, IconMarkdown, "ff-file-blue"], [/\.(ya?ml|toml|ini|xml|lock)$/i, IconBraces, "ff-file-purple"],
  [/\.(sh|ps1|bat|cmd)$/i, IconTerminal2, "text-muted-foreground"], [/\.(py|rs|go|java|kt|c|cc|cpp|h|hpp|cs|rb|php|swift|vue|sql)$/i, IconCode, "ff-file-blue"],
  [/(\.txt|license[^/\\]*|readme[^/\\]*)$/i, IconFileText, "text-muted-foreground"],
];
/** What kind of file a path is, from its name alone. */
export function FileMark({ path, size = 16 }: { path: string; size?: 14 | 16 }) {
  const [, Icon, tone] = FILE_MARKS.find(([pattern]) => pattern.test(path)) ?? [null, IconFile, "text-muted-foreground"];
  return <Icon size={size} aria-hidden="true" className={"shrink-0 " + tone} data-file-mark />;
}
const STATES = {
  add: { icon: IconSquarePlus2, tone: "ff-count-add", label: "新增" },
  delete: { icon: IconSquareMinus2, tone: "ff-count-del", label: "删除" },
  edit: { icon: IconSquareDot, tone: "ff-count-edit", label: "修改" },
};
/** What a change did to a file. The colours say which side of a change, not whether it is good. */
export function FileStatus({ kind }: { kind: keyof typeof STATES }) {
  const { icon: Icon, tone, label } = STATES[kind];
  return <span role="img" aria-label={label} title={label} className={"flex shrink-0 " + tone} data-file-status={kind}><Icon size={16} aria-hidden="true" /></span>;
}
/** The tone a changed file's name takes. */
export const fileNameTone = (kind: keyof typeof STATES) => kind === "edit" ? "" : STATES[kind].tone;
/** Lines added and removed; a side the record reports none of is left out. */
export function DiffCount({ added, removed }: { added: number; removed: number }) {
  return <span className="flex shrink-0 gap-1 tabular-nums" data-diff-count>
    {added ? <span className="ff-count-add">{"+" + added}</span> : null}
    {removed ? <span className="ff-count-del">{"−" + removed}</span> : null}
  </span>;
}
