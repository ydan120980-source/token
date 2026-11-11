// Input-method composition belongs to the input method: candidate confirmation and cancellation
// are not app commands. The shared App policy treats a key as composing while a
// composition runs, and for the rest of
// the event turn in which it ended, because some engines end composition before dispatching
// the confirming key.
let composing = false, ending = false, endTimer: ReturnType<typeof setTimeout> | undefined;
let composingTarget: EventTarget | null = null;

function reset() { composing = ending = false; composingTarget = null; clearTimeout(endTimer); }
if (typeof document !== "undefined") {
  document.addEventListener("compositionstart", event => { reset(); composing = true; composingTarget = event.target; }, true);
  document.addEventListener("compositionend", () => {
    composing = false; composingTarget = null; ending = true;
    clearTimeout(endTimer); endTimer = setTimeout(() => { ending = false; }, 0);
  }, true);
  document.addEventListener("keyup", () => { ending = false; clearTimeout(endTimer); }, true);
  window.addEventListener("blur", reset);
  document.addEventListener("focusout", event => { if (event.target === composingTarget) reset(); }, true);
  // A candidate's Enter or Escape is cancelled before any layer sees it: Radix closes popups and
  // sheets from its own document listener and skips an event whose default was prevented.
  document.addEventListener("keydown", event => { if ((event.key === "Enter" || event.key === "Escape") && isComposing(event)) event.preventDefault(); }, true);
  document.addEventListener("submit", event => { if (isComposing()) event.preventDefault(); }, true);
}

type KeyLike = { isComposing?: boolean; keyCode?: number; nativeEvent?: { isComposing?: boolean } };
export function isComposing(event?: KeyLike | null): boolean {
  return Boolean(event?.isComposing || event?.nativeEvent?.isComposing || event?.keyCode === 229 || composing || ending);
}
