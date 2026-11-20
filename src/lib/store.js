import { review } from './fsrs.js';

const KEY = 'memora:v1';
const DAY = 86400000;
export const today = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const addDays = (iso, n) => today(new Date(new Date(iso + 'T12:00:00').getTime() + n * DAY));

const defaults = () => ({
  words: {},        // id -> {id, word, meaning, pron, part, order}
  cards: {},        // id -> {S, D, last, reps, lapses, due, interval}
  days: {},         // date -> {newIds:[], learned:[], reviewed:[], done:false}
  ai: {},           // word -> AI content cache
  settings: { daily: 20, retention: 0.9, apiKey: '', voice: '', rate: 0.95 },
});

let state = load();
function load() {
  let local = {};
  try { local = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { local = {}; }
  try {
    const nativeJson = window.MemoraNative?.pullState?.();
    if (nativeJson) {
      const nativeState = JSON.parse(nativeJson);
      if ((nativeState.updatedAt || 0) >= (local.updatedAt || 0) && Object.keys(nativeState.words || {}).length) {
        local = { ...local, ...nativeState, ai: { ...(local.ai || {}), ...(nativeState.ai || {}) } };
        localStorage.setItem(KEY, JSON.stringify(local));
      }
    }
  } catch { /* ignore native bridge errors */ }
  return { ...defaults(), ...local };
}
export function pullNativeIfNewer() {
  try {
    const nativeJson = window.MemoraNative?.pullState?.();
    if (!nativeJson) return false;
    const nativeState = JSON.parse(nativeJson);
    const hasWords = Object.keys(nativeState.words || {}).length > 0;
    if (hasWords && ((nativeState.updatedAt || 0) > (state.updatedAt || 0) || !Object.keys(state.words || {}).length)) {
      state = { ...defaults(), ...state, ...nativeState, ai: { ...(state.ai || {}), ...(nativeState.ai || {}) } };
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    }
  } catch { /* ignore */ }
  return false;
}
export const save = () => {
  state.updatedAt = Date.now();
  const json = JSON.stringify(state);
  localStorage.setItem(KEY, json);
  try { window.MemoraNative?.syncState?.(json); } catch { /* ignore */ }
};
export const S = () => state;

export function importWords(list) {
  let added = 0, updated = 0;
  let order = Object.keys(state.words).length;
  const byWord = new Map(Object.values(state.words).map((w) => [w.word.toLowerCase(), w]));
  for (const w of list) {
    if (!w.word) continue;
    const ex = byWord.get(w.word.toLowerCase());
    if (ex) {
      // 기존 단어: 학습 기록은 유지하고 예문·뜻·품사만 갱신
      if (w.examples?.length && JSON.stringify(ex.examples || []) !== JSON.stringify(w.examples)) { ex.examples = w.examples; updated++; }
      if (w.part && !ex.part) { ex.part = w.part; updated++; }
      continue;
    }
    const id = 'w' + (w.id || w.word).toString().replace(/\W/g, '').slice(0, 40) + '_' + order;
    state.words[id] = { ...w, id, order: order++ };
    byWord.set(w.word.toLowerCase(), state.words[id]);
    added++;
  }
  if (added || updated) save();
  return added;
}

export function dayRec(date = today()) {
  return (state.days[date] ||= { newIds: [], learned: [], reviewed: [], done: false });
}

/** 오늘의 신규 단어 (하루 고정) */
export function todaysNew() {
  const d = dayRec();
  const need = state.settings.daily - d.newIds.length;
  if (need > 0) {
    const fresh = Object.values(state.words)
      .filter((w) => !state.cards[w.id] && !d.newIds.includes(w.id))
      .sort((a, b) => a.order - b.order)
      .slice(0, need);
    d.newIds.push(...fresh.map((w) => w.id));
    save();
  }
  return d.newIds.map((id) => state.words[id]).filter(Boolean);
}

/** 복습할 단어: 복습일이 오늘 이전이거나 '몰라요'로 넘긴 단어 (방금 넘긴 단어는 뒤로) */
export function dueReviews(date = today()) {
  return Object.entries(state.cards)
    .filter(([, c]) => c.due <= date)
    .sort(([, a], [, b]) => (a.last || 0) - (b.last || 0))
    .map(([id]) => state.words[id]).filter(Boolean);
}

/** known=true: 외웠어요(FSRS Good) → 다음 복습일 예약 / false: 몰라요(FSRS Again) → 오늘 복습 목록으로 */
export function mark(id, known, kind) {
  const prev = state.cards[id] || {};
  const c = review(prev, known ? 3 : 1, Date.now(), state.settings.retention);
  c.due = known ? addDays(today(), c.interval) : today();
  if (!known) c.interval = 0;
  state.cards[id] = c;
  const d = dayRec();
  const arr = kind === 'new' ? d.learned : d.reviewed;
  if (!arr.includes(id)) arr.push(id);
  checkDone();
  save();
  return c;
}

export function checkDone() {
  const d = dayRec();
  const newLeft = d.newIds.filter((id) => !d.learned.includes(id)).length;
  d.done = newLeft === 0 && dueReviews().length === 0 && (d.learned.length + d.reviewed.length) > 0;
  return d.done;
}

export function streak() {
  let n = 0; let date = today();
  if (!state.days[date]?.done) date = addDays(date, -1);
  while (state.days[date]?.done) { n++; date = addDays(date, -1); }
  return n;
}

export function forecast(days = 30) {
  const map = {};
  for (const c of Object.values(state.cards)) map[c.due] = (map[c.due] || 0) + 1;
  return map;
}

export function exportData() { return JSON.stringify(state); }
export function importData(json) { state = { ...defaults(), ...JSON.parse(json) }; save(); }
export function resetProgress() { state.cards = {}; state.days = {}; save(); }
