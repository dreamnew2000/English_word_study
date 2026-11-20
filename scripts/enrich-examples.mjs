import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WORDS_PATH = path.join(ROOT, 'public', 'words.json');

const strip = (s) =>
  String(s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

async function fetchNaverExamples(word) {
  const url = `https://en.dict.naver.com/api3/enko/search?query=${encodeURIComponent(word)}&m=mobile`;
  const r = await fetch(url, {
    headers: {
      Referer: 'https://en.dict.naver.com/',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    }
  });
  if (!r.ok) return { examples: [], part: '' };
  const j = await r.json();
  const wordItems = j?.searchResultMap?.searchResultListMap?.WORD?.items || [];
  const exItems = j?.searchResultMap?.searchResultListMap?.EXAMPLE?.items || [];

  const examples = [];
  const seen = new Set();
  const addEx = (enRaw, koRaw) => {
    const en = strip(enRaw);
    const ko = strip(koRaw);
    if (!en || seen.has(en.toLowerCase()) || examples.length >= 3) return;
    seen.add(en.toLowerCase());
    examples.push({ en, ko });
  };

  let part = '';
  for (const wi of wordItems) {
    for (const mc of wi.meansCollector || []) {
      if (!part && mc.partOfSpeech) part = strip(mc.partOfSpeech);
      for (const m of mc.means || []) {
        if (m.exampleOri) addEx(m.exampleOri, m.exampleTrans);
      }
    }
  }
  for (const ex of exItems) {
    addEx(ex.expExample1, ex.expExample2);
  }
  return { examples, part };
}

const data = JSON.parse(await fs.readFile(WORDS_PATH, 'utf8'));
const words = data.words || [];
const missing = words.filter((w) => !w.examples || w.examples.length === 0);
console.log(`Remaining words without examples: ${missing.length}`);

let updated = 0;
for (let i = 0; i < missing.length; i++) {
  const w = missing[i];
  try {
    const { examples, part } = await fetchNaverExamples(w.word);
    if (examples.length > 0) {
      w.examples = examples;
      updated++;
    }
    if (part && !w.part) w.part = part;
  } catch {
    // ignore
  }
  await new Promise((r) => setTimeout(r, 120));
}

await fs.writeFile(WORDS_PATH, JSON.stringify(data, null, 2));
const totalWithEx = words.filter((w) => w.examples && w.examples.length > 0).length;
console.log(`Done! ${totalWithEx}/${words.length} words now have Naver examples (+${updated}).`);
