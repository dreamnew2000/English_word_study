// 네이버 로그인 후 단어장을 가져와 public/words.json 으로 저장합니다.
// 사용법: npm run import:naver  (최초 1회 브라우저 창에서 직접 로그인, 이후 세션 재사용)
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const WB_ID = process.argv[2] || 'b06ed90bdee3585aaa75cb03db86beff';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PROFILE = path.join(ROOT, '.naver-session');
const OUT = path.join(ROOT, 'public', 'words.json');
const WB_URL = `https://learn.dict.naver.com/wordbook/enkodict/#/my/cards?wbId=${WB_ID}&qt=0&st=0&tab=list`;

const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function parseItem(item) {
  let c = item.content;
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch { c = {}; } }
  c = c || {};
  const entry = c.entry || c;
  const member = entry.members?.[0] || {};
  const word = strip(member.entry_name || entry.entry_name || item.name || item.entryName);
  const pron = strip(member.prons?.[0]?.pron_symbol || '');
  const means = (entry.means || [])
    .map((m) => strip(m.show_mean || m.mean))
    .filter(Boolean);
  const part = strip(entry.means?.[0]?.part_name || entry.means?.[0]?.part || member.part || '');
  // 네이버 사전 예문 (뜻별 예문 + 번역), 최대 3개
  const examples = [];
  for (const m of entry.means || []) {
    for (const ex of m.examples || []) {
      const en = strip(ex.show_example);
      if (en && examples.length < 3) examples.push({ en, ko: strip(ex.translations?.[0]?.show_translation) });
    }
  }
  return word ? { id: String(item.id || c.entryId || word), word, pron, part, meaning: means.slice(0, 3).join('; '), examples } : null;
}

const browser = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1100, height: 800 } });
const page = browser.pages()[0] || (await browser.newPage());
await page.goto(WB_URL);

// 로그인 여부 확인 (NID_AUT 쿠키)
const loggedIn = async () => (await browser.cookies('https://naver.com')).some((c) => c.name === 'NID_AUT');
if (!(await loggedIn())) {
  console.log('\n🔐 열린 브라우저 창에서 네이버에 로그인해 주세요. (최대 5분 대기)');
  await page.goto('https://nid.naver.com/nidlogin.login?url=' + encodeURIComponent(WB_URL));
  const start = Date.now();
  while (!(await loggedIn())) {
    if (Date.now() - start > 300_000) throw new Error('로그인 시간 초과');
    await page.waitForTimeout(1500);
  }
  console.log('✅ 로그인 확인');
  await page.goto(WB_URL);
}
await page.waitForTimeout(2000);

const words = [];
const seen = new Set();
for (let p = 1; p < 200; p++) {
  const res = await page.evaluate(async ({ wbId, p }) => {
    const url = `https://learn.dict.naver.com/gateway-api/enkodict/mywordbook/word/list/search?wbId=${wbId}&qt=0&st=0&page=${p}&page_size=100&domain=naver`;
    const r = await fetch(url, { credentials: 'include' });
    return { status: r.status, body: await r.text() };
  }, { wbId: WB_ID, p });
  if (res.status !== 200) { console.error('API 오류', res.status, res.body.slice(0, 200)); break; }
  const json = JSON.parse(res.body);
  const items = json?.data?.m_items || json?.data?.items || [];
  if (p === 1) await fs.writeFile(path.join(ROOT, '.naver-raw-sample.json'), JSON.stringify(json, null, 2));
  for (const it of items) {
    const w = parseItem(it);
    if (w && !seen.has(w.word.toLowerCase())) { seen.add(w.word.toLowerCase()); words.push(w); }
  }
  console.log(`📄 page ${p}: ${items.length}개`);
  if (items.length < 100) break;
}

await browser.close();
await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify({ source: 'naver', wbId: WB_ID, updatedAt: new Date().toISOString(), words }, null, 2));
console.log(`\n🎉 ${words.length}개 단어 저장 → public/words.json\n앱에서 [단어장 동기화]를 누르면 반영됩니다.`);
