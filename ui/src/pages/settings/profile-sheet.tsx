import { useEffect, useRef, useState } from "react";
import { Avatar, Button, FileButton, Form, Segmented, Sheet, TextField } from "@ui/kit";
import { getGlobals, getSettingsHost, type Profile } from "@ui/data";

const tones: { value: Profile["tone"]; label: string }[] = [{ value: "indigo", label: "靛蓝" }, { value: "teal", label: "青绿" }, { value: "coral", label: "珊瑚" }];
const READY = "图片仅在本机处理和保存。";

// Edit the local profile; nothing is stored until 保存资料. The image is read and decoded here
// (FileReader, Image) and kept only as a data URL in the draft.
export function ProfileSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const model = getGlobals().profileModel;
  const [draft, setDraft] = useState<Profile>(() => getSettingsHost().profile.get());
  const [name, setName] = useState(""), [bio, setBio] = useState("");
  const [fileName, setFileName] = useState("选择头像图片"), [status, setStatus] = useState(READY), [error, setError] = useState(""), [reading, setReading] = useState(false);
  // A newer pick, a reset, a tone choice or closing the sheet makes a pending read stale.
  const readToken = useRef(0);
  useEffect(() => {
    readToken.current++;
    if (!open) return;
    const saved = getSettingsHost().profile.get();
    setDraft(saved); setName(saved.name); setBio(saved.bio); setError(""); setReading(false);
    setFileName(saved.photo ? "当前使用自定义图片" : "选择头像图片"); setStatus(READY);
  }, [open]);
  const resetPick = (photo: string | null) => { readToken.current++; setReading(false); setFileName(photo ? "当前使用自定义图片" : "选择头像图片"); setStatus(READY); };
  const pick = async (file: File) => {
    const token = ++readToken.current;
    const problem = model.fileProblem(file);
    if (problem) { resetPick(draft.photo); setError(problem); return; }
    setFileName(file.name); setStatus("正在检查图片…"); setError(""); setReading(true);
    try {
      const photo = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("IMAGE_READ_FAILED")); reader.readAsDataURL(file); });
      await new Promise((resolve, reject) => { const image = new Image(); image.onload = resolve; image.onerror = reject; image.src = photo; });
      if (token !== readToken.current) return;
      setDraft(current => ({ ...current, photo })); setStatus(model.fileChosen(file));
    } catch { if (token === readToken.current) { resetPick(draft.photo); setError("图片无法读取或解码，请换一张，原头像未改变。"); } }
    finally { if (token === readToken.current) setReading(false); }
  };
  const save = () => {
    const next = model.toSave(draft, name, bio);
    const result = getSettingsHost().profile.save(next);
    if (!result.ok) { setError("本地存储空间不足，请使用默认头像。"); return; }
    onOpenChange(false);
  };
  const shown = model.previewName(name);
  return <Sheet open={open} onOpenChange={onOpenChange} title="编辑个人资料" size="sm">
    <Form onSubmit={save} aria-label="个人资料">
      <TextField value={name} onChange={setName} label="显示名称" required maxLength={model.NAME_MAX} />
      <TextField value={bio} onChange={setBio} label="简介" maxLength={model.BIO_MAX} />
      <div className="flex items-center gap-3" data-avatar-editor>
        <Avatar initials={model.initials(shown)} label="头像预览" tone={draft.tone} photo={draft.photo} size={64} />
        <div className="flex flex-col gap-2">
          <span className="text-subtitle font-semibold text-foreground">个人头像</span>
          <span className="text-caption text-muted-foreground">选择配色，或使用本地图片</span>
          <Segmented value={draft.tone} onChange={tone => { setDraft(current => ({ ...current, tone, photo: null })); resetPick(null); setError(""); }} items={tones} size="compact" aria-label="头像配色" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1"><span className="text-body text-foreground">{fileName}</span><span className="text-caption text-muted-foreground">PNG、JPEG、WebP · 最大 512 KB</span></div>
        <FileButton label="选择文件" accept={model.PHOTO_TYPES.join(",")} onFile={file => void pick(file)} busy={reading} />
      </div>
      <div className="flex items-center gap-3"><Button variant="tertiary" onClick={() => { setDraft(current => ({ ...current, photo: null })); resetPick(null); setError(""); }}>使用字母头像</Button></div>
      <p className="text-caption text-muted-foreground" role="status" data-avatar-status>{status}</p>
      {error ? <p className="text-caption text-destructive" role="alert" data-profile-error>{error}</p> : null}
      <Button variant="primary" type="submit" disabled={reading}>保存资料</Button>
    </Form>
  </Sheet>;
}
