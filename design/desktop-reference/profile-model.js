'use strict';
/**
 * The person's local profile (name, bio, avatar tone or photo), moved verbatim out of preview.js
 * (M3, 2026-10-25) so the sidebar, the React profile sheet and node --test share one rule set.
 * Pure data only: storage stays with preview.js (window.settingsHost.profile).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.profileModel = factory();
})(typeof window === 'undefined' ? this : window, function () {
  const KEY = 'agentusage-preview.profile.v1';
  const TONES = ['indigo', 'teal', 'coral'];
  const NAME_MAX = 48, BIO_MAX = 80, PHOTO_BYTES = 512 * 1024;
  const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  const DEFAULT = Object.freeze({ name: '本机用户', bio: '记录每一次 AI 协作', tone: 'indigo', photo: null });
  /** A saved profile, or the default when it is missing or invalid. */
  function parse(raw) {
    try {
      const saved = JSON.parse(raw);
      if (saved && typeof saved.name === 'string' && saved.name.trim() && saved.name.length <= NAME_MAX) return { name: saved.name,
        bio: typeof saved.bio === 'string' ? saved.bio.slice(0, BIO_MAX) : '',
        tone: TONES.includes(saved.tone) ? saved.tone : 'indigo',
        photo: typeof saved.photo === 'string' && /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(saved.photo) && saved.photo.length < 750000 ? saved.photo : null };
    } catch { /* Invalid preview preferences use defaults. */ }
    return { ...DEFAULT };
  }
  // One CJK character fills a small round avatar; Latin names keep two initials ("YD").
  function initials(name) { const letters = [...String(name).replace(/\s+/g, '')]; return /^[㐀-鿿豈-﫿]/.test(letters[0] || '') ? letters[0] : letters.slice(0, 2).join('').toUpperCase(); }
  /** While typing, an emptied name previews as "YD" rather than an empty circle. */
  function previewName(value) { return value || 'YD'; }
  /** Why a picked image cannot be used, or null. */
  function fileProblem(file) { return !PHOTO_TYPES.includes(file.type) || file.size > PHOTO_BYTES ? '请选择最大 512 KB 的 PNG、JPEG 或 WebP 图片，原头像未改变。' : null; }
  function fileChosen(file) { return '已选 ' + Math.ceil(file.size / 1024) + ' KB · 保存资料后生效，仅保存在本机。'; }
  /** What is stored on save: trimmed name and bio. */
  function toSave(draft, name, bio) { return { ...draft, name: String(name).trim(), bio: String(bio).trim() }; }
  return { KEY, TONES, NAME_MAX, BIO_MAX, PHOTO_TYPES, DEFAULT, parse, initials, previewName, fileProblem, fileChosen, toSave };
});
