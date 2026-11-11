// An upper estimate sits in a separate, quieter span.
// Input is already formatted by the existing UMD model; no arithmetic here.
export function CostAmount({ text }: { text: string }) {
  const parts = text.match(/^(.*?) (– .*)$/);
  return parts ?
    <>{parts[1]}
      <span className="font-normal text-muted-foreground">{"\u00a0" + parts[2]}</span>
    </> :
    <>{text}</>;
}
