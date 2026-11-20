import { S } from './store.js';

let voices = [];
const hasWebSpeech = () => typeof window !== 'undefined' && 'speechSynthesis' in window && !!window.speechSynthesis;

const loadVoices = () => {
  if (!hasWebSpeech()) return;
  try {
    voices = (window.speechSynthesis.getVoices() || []).filter((v) => v.lang && v.lang.startsWith('en'));
  } catch {
    voices = [];
  }
};
if (hasWebSpeech()) {
  loadVoices();
  try { window.speechSynthesis.onvoiceschanged = loadVoices; } catch { /* ignore */ }
}

export const listVoices = () => voices;

function pickVoice() {
  const pref = S().settings.voice;
  return voices.find((v) => v.name === pref)
    || voices.find((v) => /Samantha|Google US English|Ava|Allison/i.test(v.name))
    || voices.find((v) => v.lang === 'en-US') || voices[0];
}

export function stopSpeak() {
  try { window.MemoraNative?.stopSpeak?.(); } catch { /* ignore */ }
  if (hasWebSpeech()) {
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  }
}

export function speak(text, { rate, audio } = {}) {
  if (audio) {
    const a = new Audio(audio);
    return a.play().catch(() => speak(text, { rate }));
  }
  const r = rate ?? S().settings.rate ?? 0.95;
  if (window.MemoraNative?.speak) {
    try {
      window.MemoraNative.speak(String(text || ''), Number(r));
      const estMs = Math.max(700, Math.min(4000, String(text || '').length * 85));
      return new Promise((res) => setTimeout(res, estMs));
    } catch { /* fallback to speechSynthesis */ }
  }
  if (!hasWebSpeech()) return Promise.resolve();
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang || 'en-US';
    u.rate = r;
    window.speechSynthesis.speak(u);
    return new Promise((res) => { u.onend = res; u.onerror = res; });
  } catch {
    return Promise.resolve();
  }
}
