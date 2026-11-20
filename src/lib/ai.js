import { S, save } from './store.js';

const MODEL = 'gemini-2.5-flash';
const endpoint = (key) => `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

async function gemini(prompt, json = true) {
  const key = S().settings.apiKey;
  if (!key) throw new Error('NO_KEY');
  const r = await fetch(endpoint(key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: json ? { responseMimeType: 'application/json', temperature: 0.7 } : { temperature: 0.6 },
    }),
  });
  if (!r.ok) throw new Error('Gemini ' + r.status);
  const j = await r.json();
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  return json ? JSON.parse(text) : text;
}

/** 단어 학습 자료: 예문(연어 포함) · 연어 · 어원 · 연상법 · 유의어 */
export async function wordInsight(w) {
  const cache = S().ai[w.word];
  if (cache) return cache;
  let data;
  try {
    data = await gemini(`You are an expert English vocabulary coach for Korean learners.
Word: "${w.word}" (Korean meaning: ${w.meaning || 'unknown'}).
Return JSON with keys:
- "examples": 3 items {"en": natural native-like sentence using a common collocation of the word (CEFR B1-B2), "ko": Korean translation, "chunk": the collocation used}
- "collocations": 4 frequent corpus collocations (strings)
- "etymology": short Korean explanation of prefix/root/suffix if meaningful, else ""
- "mnemonic": a short vivid Korean keyword-method mnemonic (sound-alike + image)
- "synonyms": up to 3 synonyms with a brief Korean nuance difference, as strings
- "imagery": one sentence in Korean describing a vivid mental image of the meaning`);
    data.source = 'ai';
  } catch (e) {
    data = await dictFallback(w);
    data.error = e.message;
  }
  S().ai[w.word] = data;
  save();
  return data;
}

async function dictFallback(w) {
  const out = { examples: [], collocations: [], etymology: '', mnemonic: '', synonyms: [], source: 'dict' };
  try {
    const r = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(w.word));
    const j = await r.json();
    for (const e of j) {
      for (const p of e.phonetics || []) if (p.audio && !out.audio) out.audio = p.audio;
      for (const m of e.meanings || []) {
        for (const d of m.definitions || []) if (d.example && out.examples.length < 3) out.examples.push({ en: d.example, ko: '', chunk: '' });
        out.synonyms.push(...(m.synonyms || []).slice(0, 3 - out.synonyms.length));
      }
    }
  } catch { /* ignore */ }
  return out;
}

/** 출력 훈련: 학습자 문장 피드백 */
export async function feedback(word, sentence) {
  return gemini(`A Korean learner wrote a sentence using the English word "${word}".
Sentence: "${sentence}"
Return JSON: {"ok": boolean (word used correctly & natural), "corrected": improved natural version, "comment": 1-2 sentence feedback in Korean focusing on collocation/grammar/nuance}`);
}

export const hasKey = () => !!S().settings.apiKey;
