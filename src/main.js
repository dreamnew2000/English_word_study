import './index.css';
import * as store from './lib/store.js';
import { S, today, addDays } from './lib/store.js';
import { wordInsight, feedback, hasKey } from './lib/ai.js';
import { speak, stopSpeak, listVoices } from './lib/tts.js';
import { retrievability } from './lib/fsrs.js';

const $view = document.getElementById('view');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = (msg) => { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600); };
let keyHandler = null;
const onKey = (fn) => { keyHandler = fn; };
document.addEventListener('keydown', (e) => { if (keyHandler && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) keyHandler(e); });

// ---------- Router ----------
const routes = { '': home, learn, review, calendar, words, settings };
function router() {
  const r = location.hash.replace('#/', '').split('?')[0];
  keyHandler = null;
  stopSpeak();
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === r));
  $view.style.animation = 'none'; $view.offsetHeight; $view.style.animation = '';
  try {
    (routes[r] || home)();
  } catch (err) {
    console.error('Router error:', err);
    toast('화면 로드 오류: ' + err.message);
  }
}
window.addEventListener('hashchange', router);
document.querySelectorAll('.nav a').forEach((a) => {
  a.addEventListener('click', () => {
    const targetHash = a.getAttribute('href') || '#/';
    if (location.hash === targetHash || (!location.hash && targetHash === '#/')) {
      setTimeout(router, 0);
    }
  });
});

// ---------- Sync ----------
const REMOTE_URL = 'https://dreamnew2000.github.io/English_word_study';
const APK_URL = `${REMOTE_URL}/Memora-debug.apk`;

async function syncWords(silent) {
  store.pullNativeIfNewer();
  let added = 0;
  try {
    const r = await fetch('./words.json?t=' + Date.now());
    if (r.ok) {
      const j = await r.json();
      added += store.importWords(j.words || []);
    }
  } catch { /* ignore local fetch error */ }
  if (!silent) {
    try {
      const r2 = await fetch(`${REMOTE_URL}/words.json?t=${Date.now()}`);
      if (r2.ok) {
        const j2 = await r2.json();
        added += store.importWords(j2.words || []);
      }
    } catch { /* offline or not deployed yet */ }
    toast(`📥 단어장 동기화 완료: 새 단어 ${added}개 (전체 ${Object.keys(S().words).length}개)`);
  }
  return added;
}
async function naverLogin(btn) {
  if (window.MemoraNative) {
    await syncWords(false);
    router();
    return;
  }
  btn.disabled = true; btn.innerHTML = '⏳ 브라우저 창에서 네이버 로그인 중…';
  toast('새 브라우저 창이 열립니다. 네이버에 로그인해 주세요.');
  try {
    const r = await fetch('/api/naver-import?wbId=' + encodeURIComponent(S().settings.wbId || ''));
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || j.log?.slice(-200));
    await syncWords();
  } catch (e) { toast('가져오기 실패: ' + e.message); console.error(e); }
  router();
}

// ---------- Home ----------
function home() {
  const total = Object.keys(S().words).length;
  if (!total) return onboarding();
  const nw = store.todaysNew();
  const d = store.dayRec();
  const due = store.dueReviews();
  const learnedNew = d.learned.length;
  const mastered = Object.values(S().cards).filter((c) => c.S > 21).length;
  const fc = store.forecast();
  const next7 = [...Array(7)].map((_, i) => { const dt = addDays(today(), i); return { dt, n: fc[dt] || 0 }; });
  const max7 = Math.max(1, ...next7.map((x) => x.n));
  const pct = Math.round(((learnedNew + d.reviewed.length) / Math.max(1, nw.length + d.reviewed.length + due.length)) * 100);

  $view.innerHTML = `
  <div class="head"><div><h1>안녕하세요 👋 <span class="grad-text">오늘의 학습</span></h1>
    <p class="sub">${new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })} · 인출 연습 + 간격 반복으로 오래 기억하세요</p></div>
    <div class="row">
      <a class="btn" href="${window.MemoraNative ? APK_URL : './Memora-debug.apk'}" download="Memora-debug.apk" target="_blank">📲 위젯 앱(APK) ${window.MemoraNative ? '업데이트' : '받기'}</a>
      <button class="btn" id="btn-sync">🔄 단어장 동기화</button>
    </div></div>

  <div class="glass cta">
    <div style="flex:1"><h2 style="margin-bottom:6px">${d.done ? '🎉 오늘 목표 달성!' : '오늘 해야 할 학습'}</h2>
      <p class="sub" style="margin-bottom:14px">새 단어 ${learnedNew}/${nw.length} · 복습 남음 ${due.length}개</p>
      <div class="progress"><i style="width:${pct}%"></i></div></div>
    <div class="row">
      <a class="btn primary lg" id="btn-start-learn" href="#/learn">✨ 새 단어 ${nw.length - learnedNew}</a>
      <a class="btn lg" id="btn-start-review" href="#/review">🔁 복습 ${due.length}</a>
    </div>
  </div>

  <div class="grid g4" style="margin:20px 0">
    ${stat('🔥', '연속 학습', store.streak() + '일')}
    ${stat('📚', '전체 단어', total)}
    ${stat('🧠', '학습 중', Object.keys(S().cards).length)}
    ${stat('🏆', '장기 기억 (S>21일)', mastered)}
  </div>

  <div class="grid g2">
    <div class="glass card"><h2>📉 망각 곡선과 간격 반복</h2>${curveSVG()}
      <p class="sub" style="font-size:13px">회색: 복습 없이 망각되는 곡선 · 컬러: 기억이 90% 근처로 떨어질 때마다 복습하면 안정성(S)이 커져 곡선이 점점 완만해집니다 (FSRS).</p></div>
    <div class="glass card"><h2>🗓 7일 복습 예보</h2>
      <div style="display:flex;align-items:flex-end;gap:10px;height:180px;margin-top:10px">
      ${next7.map((x, i) => `<div style="flex:1;text-align:center"><div style="font-size:12px;color:var(--muted)">${x.n}</div>
        <div style="height:${(x.n / max7) * 130 + 4}px;background:var(--grad);border-radius:8px;margin:4px 0;opacity:${i ? 0.6 : 1}"></div>
        <div style="font-size:12px;color:var(--muted)">${i ? new Date(x.dt).toLocaleDateString('ko-KR', { weekday: 'short' }) : '오늘'}</div></div>`).join('')}
      </div></div>
  </div>`;
  document.getElementById('btn-sync').onclick = async () => { await syncWords(); home(); };
}
const stat = (ic, l, v) => `<div class="glass card stat"><div class="ic">${ic}</div><div class="v">${v}</div><div class="l">${l}</div></div>`;

function curveSVG() {
  const W = 460, H = 180, days = 30;
  const x = (t) => 30 + (t / days) * (W - 40), y = (r) => 10 + (1 - r) * (H - 30);
  let base = '', sr = '';
  for (let t = 0; t <= days; t += 0.25) base += `${t ? 'L' : 'M'}${x(t)},${y(retrievability(t, 1))}`;
  let S0 = 1, t0 = 0;
  const reviews = [];
  for (let t = 0; t <= days; t += 0.25) {
    let r = retrievability(t - t0, S0);
    if (r < 0.9 && t - t0 > 0.5) { reviews.push(t); t0 = t; S0 *= 2.6; r = 1; sr += `L${x(t)},${y(1)}`; }
    sr += `${t ? 'L' : 'M'}${x(t)},${y(r)}`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    <defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="hsl(258,90%,66%)"/><stop offset="1" stop-color="hsl(190,90%,55%)"/></linearGradient></defs>
    <line x1="30" x2="${W - 10}" y1="${y(0.9)}" y2="${y(0.9)}" stroke="rgba(255,255,255,.2)" stroke-dasharray="4 4"/>
    <text x="0" y="${y(0.9) + 4}" fill="#9aa0c3" font-size="10">90%</text><text x="0" y="${y(0) + 4}" fill="#9aa0c3" font-size="10">0%</text>
    <path d="${base}" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2"/>
    <path d="${sr}" fill="none" stroke="url(#lg)" stroke-width="3"/>
    ${reviews.map((t) => `<circle cx="${x(t)}" cy="${y(1)}" r="4" fill="hsl(320,85%,65%)"/>`).join('')}
    <text x="${W - 50}" y="${H - 2}" fill="#9aa0c3" font-size="10">${days}일</text></svg>`;
}

function onboarding() {
  $view.innerHTML = `<div class="glass empty" style="max-width:640px;margin:40px auto">
    <div class="big">📗</div><h1>네이버 단어장 연결</h1>
    <p class="sub" style="margin:12px 0 28px;line-height:1.7">버튼을 누르면 새 브라우저 창이 열립니다.<br/>네이버에 로그인하면 단어장 전체를 자동으로 가져옵니다. (로그인 세션은 이 컴퓨터에만 저장)</p>
    <div class="row"><button class="btn primary lg" id="btn-naver">🔐 네이버 로그인으로 가져오기</button>
    <button class="btn lg" id="btn-sync0">📥 이미 가져온 words.json 불러오기</button></div></div>`;
  document.getElementById('btn-naver').onclick = (e) => naverLogin(e.currentTarget);
  document.getElementById('btn-sync0').onclick = async () => { await syncWords(); router(); };
}

// ---------- Insight panel ----------
function highlight(text, w) {
  const stem = w.word.split(' ')[0].slice(0, Math.max(3, w.word.length - 2));
  return esc(text).replace(new RegExp(`(\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*)`, 'gi'), '<mark>$1</mark>');
}
/** 네이버 단어장 예문 (오프라인에서도 즉시 표시) */
function naverExamplesHTML(w) {
  if (!w.examples?.length) return '';
  return `<div><div class="tag">📗 단어장 예문</div>
    ${w.examples.map((e, i) => `<div class="ex"><button class="icon-btn" data-nsay="${i}" title="원어민 음성">🔊</button>
      <div><div class="en">${highlight(e.en, w)}</div>${e.ko ? `<div class="ko">${esc(e.ko)}</div>` : ''}</div></div>`).join('')}</div>`;
}
function bindNaverSay(el, w) {
  el.querySelectorAll('[data-nsay]').forEach((b) => (b.onclick = () => speak(w.examples[b.dataset.nsay].en)));
}
async function renderInsight(el, w) {
  const naver = naverExamplesHTML(w);
  el.innerHTML = naver + '<div id="ai-box"><div class="skeleton"></div><div class="skeleton" style="width:80%"></div></div>';
  bindNaverSay(el, w);
  const ai = await wordInsight(w);
  if (!el.isConnected) return;
  // 네이버 예문이 있으면 사전 대체 예문은 생략, AI 예문은 함께 표시
  const showAiEx = ai.examples?.length && (ai.source === 'ai' || !w.examples?.length);
  el.innerHTML = naver + `
    ${showAiEx ? `<div><div class="tag">${ai.source === 'ai' ? '🤖 AI 예문 · 연어 청크' : '📖 사전 예문'}</div>
      ${ai.examples.map((e, i) => `<div class="ex"><button class="icon-btn" data-say="${i}" title="원어민 음성">🔊</button>
        <div><div class="en">${highlight(e.en, w)}</div>${e.ko ? `<div class="ko">${esc(e.ko)}</div>` : ''}</div></div>`).join('')}</div>` : ''}
    ${ai.collocations?.length ? `<div><div class="tag">🔗 자주 쓰는 연어</div><div class="chips">${ai.collocations.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div></div>` : ''}
    ${ai.etymology ? `<div class="note"><b>🌱 어원</b><br/>${esc(ai.etymology)}</div>` : ''}
    ${ai.imagery ? `<div class="note" style="border-color:var(--p2);background:hsla(190,90%,55%,.08)"><b>🖼 이미지로 떠올리기</b><br/>${esc(ai.imagery)}</div>` : ''}
    ${ai.mnemonic ? `<div class="note" style="border-color:var(--warn);background:hsla(38,95%,60%,.08)"><b>💡 연상법</b><br/>${esc(ai.mnemonic)}</div>` : ''}
    ${ai.synonyms?.length ? `<div><div class="tag">≈ 유의어</div><div class="chips">${ai.synonyms.map((c) => `<span class="chip" style="background:hsla(258,90%,66%,.12);border-color:hsla(258,90%,66%,.3)">${esc(c)}</span>`).join('')}</div></div>` : ''}`;
  bindNaverSay(el, w);
  el.querySelectorAll('[data-say]').forEach((b) => (b.onclick = () => speak(ai.examples[b.dataset.say].en)));
  if (ai.audio) w._audio = ai.audio;
}

// ---------- Learn (새 단어 학습: 뜻·단어장 예문 확인 후 ✓ 체크 또는 🔁 복습으로 넘기기) ----------
function learn() {
  const allToday = store.todaysNew();
  const list = allToday.filter((w) => !store.dayRec().learned.includes(w.id));
  if (!list.length) {
    const dueCount = store.dueReviews().length;
    return dueCount
      ? doneScreen(`오늘의 새 단어를 모두 확인했어요! (복습할 단어 ${dueCount}개)`, `🔁 복습하러 가기 (${dueCount}개)`, '#/review')
      : doneScreen('오늘의 새 단어와 복습을 모두 마쳤어요! 🎉', '📅 달력 보기', '#/calendar');
  }
  const w = list[0];
  const doneCount = allToday.length - list.length;
  const pronClean = (w.pron || '').replace(/^\[|\]$/g, '');
  $view.innerHTML = `<div class="study">
    ${studyHead('✨ 오늘의 새 단어', `${doneCount + 1} / ${allToday.length} · 외웠으면 체크(✓), 모르면 복습으로 넘기세요`, (doneCount / Math.max(1, allToday.length)) * 100)}
    <div class="glass flash">
      <div class="row"><div class="word">${esc(w.word)}</div><button class="icon-btn" id="btn-say" title="단어 발음">🔊</button></div>
      ${pronClean || w.part ? `<div class="pron">${pronClean ? `[${esc(pronClean)}]` : ''} ${esc(w.part || '')}</div>` : ''}
      <div class="meaning">${esc(w.meaning)}</div>
      <div class="insight" id="insight"></div>
      <div class="marks" style="margin-top:14px">
        <button class="m-no" id="btn-to-review">🔁 복습으로 넘기기<small>모르는 단어 · 복습 탭에 추가</small></button>
        <button class="m-yes" id="btn-check">✅ 외웠어요<small>체크하고 다음 단어</small></button>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn" id="btn-shadow">🎧 3회 반복 듣기</button>
      </div>
      <details style="text-align:left"><summary style="cursor:pointer;color:var(--muted)">✍️ 나만의 문장 만들기 (선택)</summary>
        <div style="display:flex;gap:8px;margin-top:10px"><input id="my-sent" placeholder="${esc(w.word)}를 넣어 영어 문장을 써보세요"/><button class="btn" id="btn-fb">확인</button></div>
        <div id="fb" style="margin-top:10px"></div></details>
    </div></div>`;
  const say = () => speak(w.word, { audio: w._audio });
  say();
  renderInsight(document.getElementById('insight'), w);
  document.getElementById('btn-say').onclick = say;
  document.getElementById('btn-shadow').onclick = async () => { for (let k = 0; k < 3; k++) { await speak(w.word, { rate: 0.85 }); await new Promise((r) => setTimeout(r, 1200)); } };
  document.getElementById('btn-fb').onclick = () => writeFeedback(w);
  const handle = (known) => {
    const c = store.mark(w.id, known, 'new');
    toast(known ? `✅ 외움 체크! (${c.interval}일 뒤 복습)` : '🔁 복습할 단어 목록으로 넘겼어요');
    learn();
  };
  document.getElementById('btn-to-review').onclick = () => handle(false);
  document.getElementById('btn-check').onclick = () => handle(true);
  onKey((e) => {
    if (e.code === 'Space' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); handle(true); }
    else if (e.key === 'ArrowLeft' || e.key === 'x') { e.preventDefault(); handle(false); }
  });
}

async function writeFeedback(w) {
  const v = document.getElementById('my-sent').value.trim(); const fb = document.getElementById('fb');
  if (!v) return;
  if (!hasKey()) { fb.innerHTML = '<p class="sub">AI 피드백은 Gemini API 키가 필요합니다. 직접 소리 내어 읽어보는 것만으로도 효과가 있어요!</p>'; return; }
  fb.innerHTML = '<div class="skeleton"></div>';
  try {
    const r = await feedback(w.word, v);
    fb.innerHTML = `<div class="note" style="border-color:${r.ok ? 'var(--ok)' : 'var(--warn)'}">${r.ok ? '✅' : '✏️'} ${esc(r.comment)}<br/><b>${esc(r.corrected)}</b></div>`;
  } catch (e) { fb.textContent = '오류: ' + e.message; }
}

// ---------- Review ----------
function review() {
  const due = store.dueReviews();
  if (!due.length) {
    const nLeft = store.todaysNew().filter((w) => !store.dayRec().learned.includes(w.id)).length;
    return nLeft ? doneScreen('복습할 단어가 없어요.', `새 단어 ${nLeft}개 학습하기`, '#/learn') : doneScreen('오늘의 복습 완료! 기억이 단단해지고 있어요.', '달력 보기', '#/calendar');
  }
  quiz(due, 'review', (st) => reviewSummary(st), '🔁 복습');
}

function reviewSummary({ known, unknown }) {
  const left = store.dueReviews().length;
  if (!left) return review();
  $view.innerHTML = `<div class="glass empty" style="max-width:600px;margin:40px auto"><div class="big">📝</div>
    <h1>✓ ${known}개 외움 · ✗ ${unknown}개 다시 복습</h1>
    <p class="sub" style="margin:12px 0 24px">모르는 단어 ${left}개가 복습 목록에 남아 있어요. 조금 쉬었다가 다시 떠올려 보면 더 오래 기억됩니다.</p>
    <div class="row"><button class="btn primary lg" id="btn-again">🔁 남은 ${left}개 복습하기</button><a class="btn lg" href="#/">홈으로</a></div></div>`;
  document.getElementById('btn-again').onclick = review;
}

/** 공통 인출 퀴즈: 뜻을 떠올린 뒤 확인 → ✓ 외웠어요 / ✗ 몰라요(복습 목록으로) */
function quiz(queue, kind, onFinish, title) {
  const total = queue.length; let known = 0, unknown = 0;
  const step = () => {
    if (!queue.length) {
      store.checkDone();
      toast(store.dayRec().done ? '🎉 오늘 목표 달성! 달력에 체크되었어요.' : unknown ? `✗ ${unknown}개는 복습 목록으로 넘겼어요` : '👍 모두 외웠어요!');
      return onFinish({ known, unknown });
    }
    const w = queue[0];
    const card = S().cards[w.id];
    const mode = kind === 'review' && card?.reps >= 2 && Math.random() < 0.3 ? 'spell' : 'recall';
    const done = known + unknown;
    let revealed = false;
    $view.innerHTML = `<div class="study">
      ${studyHead(title, `${done + 1}/${total} · ${mode === 'spell' ? '뜻을 보고 영어 철자를 입력해 보세요' : '뜻을 먼저 떠올린 뒤 확인하세요'}`, kind === 'new' ? 50 + (done / total) * 50 : (done / total) * 100)}
      <div class="glass flash" id="flash">
        ${mode === 'spell'
          ? `<div class="meaning" style="font-size:28px">${esc(w.meaning)}</div>
             <input id="spell" placeholder="영어 단어를 입력하세요" autocomplete="off" autocapitalize="off" style="text-align:center;font-size:22px;max-width:400px;margin:0 auto"/>`
          : `<div class="row"><div class="word">${esc(w.word)}</div><button class="icon-btn" id="btn-say">🔊</button></div>
             ${w.pron ? `<div class="pron">${esc(w.pron)}</div>` : ''}`}
        <div id="answer"><div class="hidden-box">🤔 뜻을 머릿속으로 먼저 떠올려 보세요</div></div>
        <div id="actions" class="row"><button class="btn primary lg" id="btn-reveal">정답 확인 <span class="kbd">Space</span></button></div>
      </div></div>`;
    if (mode === 'recall') { speak(w.word, { audio: w._audio }); document.getElementById('btn-say').onclick = () => speak(w.word); }
    else setTimeout(() => document.getElementById('spell')?.focus(), 50);

    const reveal = () => {
      if (revealed) return; revealed = true;
      let correct = null;
      if (mode === 'spell') {
        const v = document.getElementById('spell').value.trim().toLowerCase();
        correct = v === w.word.toLowerCase();
        document.getElementById('spell').style.borderColor = correct ? 'var(--ok)' : 'var(--bad)';
        speak(w.word);
      }
      document.getElementById('answer').innerHTML = `
        ${mode === 'spell' ? `<div class="word" style="font-size:40px">${esc(w.word)}</div><div class="meaning" style="font-size:18px">${esc(w.meaning)}</div>` : `<div class="meaning" style="font-size:26px">${esc(w.meaning)}</div>`}
        <div class="insight" id="insight" style="margin-top:14px"></div>`;
      renderInsight(document.getElementById('insight'), w);
      document.getElementById('actions').innerHTML = `<div class="marks">
        <button class="m-no" id="btn-no">✗ 몰라요<small>복습 목록으로</small></button>
        <button class="m-yes" id="btn-yes" ${correct === true ? 'style="outline:3px solid var(--ok)"' : ''}>✓ 외웠어요<small>다음 단어</small></button></div>`;
      document.getElementById('btn-no').onclick = () => mark(false);
      document.getElementById('btn-yes').onclick = () => mark(true);
    };
    const mark = (ok) => {
      queue.shift();
      const c = store.mark(w.id, ok, kind);
      if (ok) { known++; toast(`✓ ${c.interval}일 뒤 복습 (${c.due})`); }
      else { unknown++; toast('✗ 복습 목록에 추가했어요'); }
      step();
    };
    document.getElementById('btn-reveal').onclick = reveal;
    const sp = document.getElementById('spell'); if (sp) sp.onkeydown = (e) => { if (e.key === 'Enter') reveal(); };
    onKey((e) => {
      if (e.code === 'Space' && !revealed) { e.preventDefault(); reveal(); }
      else if (revealed && (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === 'o')) mark(true);
      else if (revealed && (e.key === 'ArrowLeft' || e.key === 'x')) mark(false);
    });
  };
  step();
}

const studyHead = (t, s, p) => `<div class="head" style="margin-bottom:16px"><div><h1 style="font-size:26px">${t}</h1><p class="sub">${s}</p></div>
  <a class="btn" href="#/">✕ 나가기</a></div><div class="progress" style="margin-bottom:20px"><i style="width:${p}%"></i></div>`;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
function doneScreen(msg, label, href) {
  $view.innerHTML = `<div class="glass empty" style="max-width:600px;margin:40px auto"><div class="big">🎉</div><h1>${msg}</h1>
    <p class="sub" style="margin:12px 0 24px">오늘 학습한 단어를 나만의 문장으로 말해 보거나, 영어 글에서 다시 찾아보면 기억이 더 오래갑니다.</p>
    <div class="row"><a class="btn primary lg" href="${href}">${label}</a><a class="btn lg" href="#/">홈으로</a></div></div>`;
}

// ---------- Calendar ----------
let calCursor = new Date(); let calSel = today();
function calendar() {
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  const first = new Date(y, m, 1), start = new Date(y, m, 1 - first.getDay());
  const fc = store.forecast(); const t = today();
  const cells = [...Array(42)].map((_, i) => {
    const dt = new Date(start); dt.setDate(start.getDate() + i);
    const iso = store.today(dt); const rec = S().days[iso];
    const cnt = rec ? rec.learned.length + rec.reviewed.length : 0;
    const cls = ['cal-day', dt.getMonth() !== m && 'other', iso === t && 'today', rec?.done ? 'done' : cnt && 'partial', iso === calSel && 'sel'].filter(Boolean).join(' ');
    const meta = iso > t ? (fc[iso] ? `복습 ${fc[iso]}` : '') : rec && cnt ? `새 ${rec.learned.length} · 복 ${rec.reviewed.length}` : '';
    return `<div class="${cls}" data-d="${iso}" id="cal-${iso}"><span class="n">${dt.getDate()}</span>${rec?.done ? '<span class="chk">✅</span>' : ''}<span class="meta">${meta}</span></div>`;
  }).join('');
  const monthDone = Object.entries(S().days).filter(([d, r]) => d.startsWith(`${y}-${String(m + 1).padStart(2, '0')}`) && r.done).length;

  $view.innerHTML = `<div class="head"><div><h1>📅 학습 달력</h1><p class="sub">이번 달 목표 달성 ${monthDone}일 · 연속 ${store.streak()}일 🔥</p></div>
    <div class="row"><button class="btn" id="cal-prev">‹</button><b style="min-width:120px;text-align:center">${y}년 ${m + 1}월</b><button class="btn" id="cal-next">›</button></div></div>
    <div class="grid g2"><div class="glass card"><div class="cal-grid">${'일월화수목금토'.split('').map((d) => `<div class="cal-dow">${d}</div>`).join('')}${cells}</div>
      <p class="sub" style="font-size:13px;margin-top:14px">✅ 오늘의 새 단어 + 복습을 모두 끝낸 날 · 🟧 일부 학습 · 미래 날짜는 예정 복습량</p></div>
    <div class="glass card" id="day-detail"></div></div>`;
  document.getElementById('cal-prev').onclick = () => { calCursor = new Date(y, m - 1, 1); calendar(); };
  document.getElementById('cal-next').onclick = () => { calCursor = new Date(y, m + 1, 1); calendar(); };
  document.querySelectorAll('.cal-day').forEach((c) => (c.onclick = () => { calSel = c.dataset.d; calendar(); }));
  dayDetail(calSel);
}
function dayDetail(iso) {
  const el = document.getElementById('day-detail'); const rec = S().days[iso]; const t = today();
  const W = S().words;
  const list = (ids) => ids.map((id) => W[id]).filter(Boolean).map((w) => `<tr><td><b>${esc(w.word)}</b> <button class="icon-btn" style="width:30px;height:30px;font-size:13px" data-say="${esc(w.word)}">🔊</button></td><td>${esc(w.meaning)}</td></tr>`).join('');
  let html = `<h2>${new Date(iso + 'T12:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })} ${rec?.done ? '✅' : ''}</h2>`;
  if (iso > t) {
    const ids = Object.entries(S().cards).filter(([, c]) => c.due === iso).map(([id]) => id);
    html += ids.length ? `<p class="sub">예정 복습 ${ids.length}개</p><table>${list(ids)}</table>` : '<p class="sub">예정된 복습이 없습니다.</p>';
  } else if (rec && (rec.learned.length || rec.reviewed.length)) {
    html += `<div class="tag" style="margin-top:8px">새로 외운 단어 ${rec.learned.length}</div><table>${list(rec.learned)}</table>
      <div class="tag" style="margin-top:18px">복습한 단어 ${rec.reviewed.length}</div><table>${list(rec.reviewed)}</table>`;
  } else html += '<p class="sub">학습 기록이 없습니다.</p>';
  el.innerHTML = `<div style="max-height:560px;overflow:auto">${html}</div>`;
  el.querySelectorAll('[data-say]').forEach((b) => (b.onclick = () => speak(b.dataset.say)));
}

// ---------- Words ----------
function words() {
  const all = Object.values(S().words).sort((a, b) => a.order - b.order);
  const render = (q = '') => {
    const rows = all.filter((w) => !q || w.word.toLowerCase().includes(q) || w.meaning?.includes(q)).slice(0, 300).map((w) => {
      const c = S().cards[w.id];
      const st = !c ? '<span class="pill new">새 단어</span>' : c.S > 21 ? '<span class="pill master">장기 기억</span>' : '<span class="pill learn">학습 중</span>';
      const r = c ? Math.round(retrievability((Date.now() - c.last) / 86400000, c.S) * 100) + '%' : '-';
      const ex = w.examples?.[0];
      const exHTML = ex ? `<div class="wl-ex">${highlight(ex.en, w)}${ex.ko ? `<span>${esc(ex.ko)}</span>` : ''}</div>` : '';
      return `<tr><td><b>${esc(w.word)}</b></td><td>${esc(w.meaning)}${exHTML}</td><td>${st}</td><td>${r}</td><td>${c?.due || '-'}</td><td><button class="icon-btn" style="width:32px;height:32px;font-size:14px" data-say="${esc(w.word)}">🔊</button></td></tr>`;
    }).join('');
    document.getElementById('tbody').innerHTML = rows;
    document.querySelectorAll('[data-say]').forEach((b) => (b.onclick = () => speak(b.dataset.say)));
  };
  $view.innerHTML = `<div class="head"><div><h1>📚 단어장</h1><p class="sub">네이버 단어장 ${all.length}개 · R = 현재 기억 확률(FSRS)</p></div>
    <div class="row"><input id="q" placeholder="🔍 검색" style="width:220px"/><button class="btn primary" id="btn-naver2">🔐 네이버에서 다시 가져오기</button></div></div>
    <div class="glass card" style="overflow:auto"><table><thead><tr><th>단어</th><th>뜻</th><th>상태</th><th>R</th><th>다음 복습</th><th></th></tr></thead><tbody id="tbody"></tbody></table></div>`;
  render();
  document.getElementById('q').oninput = (e) => render(e.target.value.trim().toLowerCase());
  document.getElementById('btn-naver2').onclick = (e) => naverLogin(e.currentTarget);
}

// ---------- Settings ----------
function settings() {
  const s = S().settings;
  $view.innerHTML = `<div class="head"><div><h1>⚙️ 설정</h1></div></div>
  <div class="grid g2"><div class="glass card">
    <div class="field"><label>하루 새 단어 수</label><input type="number" id="set-daily" min="5" max="100" value="${s.daily}"/></div>
    <div class="field"><label>목표 기억률 (FSRS desired retention): <b id="ret-v">${Math.round(s.retention * 100)}%</b></label>
      <input type="range" id="set-ret" min="0.8" max="0.97" step="0.01" value="${s.retention}"/><small>연구 권장값 90%. 높일수록 복습이 잦아집니다.</small></div>
    <div class="field"><label>Gemini API 키 (AI 예문)</label><input type="password" id="set-key" value="${esc(s.apiKey)}" placeholder="AIza..."/>
      <small><a href="https://aistudio.google.com/apikey" target="_blank" style="color:var(--p2)">Google AI Studio</a>에서 무료 발급 · 브라우저에만 저장됩니다.</small></div>
    <div class="field"><label>원어민 음성</label><select id="set-voice"><option value="">자동 (en-US)</option>${listVoices().map((v) => `<option ${v.name === s.voice ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div>
    <div class="field"><label>음성 속도: <b id="rate-v">${s.rate}</b></label><input type="range" id="set-rate" min="0.6" max="1.2" step="0.05" value="${s.rate}"/></div>
    <div class="field"><label>네이버 단어장 ID (wbId)</label><input id="set-wb" value="${esc(s.wbId || 'b06ed90bdee3585aaa75cb03db86beff')}"/></div>
    <div class="row" style="justify-content:flex-start"><button class="btn primary" id="btn-save">저장</button><button class="btn" id="btn-test-voice">🔊 음성 테스트</button></div>
  </div>
  <div class="glass card"><h2>📱 안드로이드 홈 화면 위젯</h2>
    <p class="sub" style="font-size:14px;line-height:1.6;margin-bottom:12px">홈 화면에서 바로 오늘의 단어·복습 단어를 확인하고, <b>뜻 보기(인출 연습) → ✓ 외웠어요 / ✗ 몰라요 · 단어장 예문 · 원어민 발음(🔊)</b>을 실행할 수 있습니다. 위젯에서 평가한 기록은 앱과 달력에 즉시 연동됩니다.</p>
    <div class="row" style="justify-content:flex-start;margin-bottom:20px">
      <button class="btn primary" id="btn-pin-widget">📌 홈 화면에 위젯 추가</button>
      <button class="btn" id="btn-refresh-widget">🔄 위젯 즉시 새로고침</button>
      <a class="btn" href="${window.MemoraNative ? APK_URL : './Memora-debug.apk'}" download="Memora-debug.apk" target="_blank">📲 최신 위젯 APK 다운로드</a>
    </div>
    <h2>데이터</h2>
    <div class="row" style="justify-content:flex-start"><button class="btn" id="btn-export">💾 백업 내보내기</button><label class="btn" for="imp">📂 백업 불러오기</label><input type="file" id="imp" accept=".json" hidden/></div>
    <button class="btn" id="btn-reset" style="margin-top:14px;color:var(--bad)">학습 기록 초기화</button>
    <h2 style="margin-top:28px">🔬 적용된 연구 원리</h2>
    <ul class="sub" style="line-height:1.9;padding-left:18px;font-size:14px">
      <li>FSRS-5 (DSR 모델) 간격 반복 — 목표 기억률 도달 시점에 복습</li>
      <li>인출 연습 — 정답 확인 전 백지 회상 → ✓ 외웠어요 / ✗ 몰라요(복습 목록으로)</li>
      <li>바람직한 어려움 — 힌트 차단, 영↔한 인터리빙, 철자 생성</li>
      <li>처리 깊이 · 어휘적 접근 — AI 연어 청크 예문, 어원, 유의어</li>
      <li>이중 부호화 — 원어민 음성, 이미지 연상, 섀도잉</li>
      <li>출력 가설 — 나만의 문장 작성 + AI 피드백</li></ul></div></div>`;
  const $ = (id) => document.getElementById(id);
  $('set-ret').oninput = (e) => ($('ret-v').textContent = Math.round(e.target.value * 100) + '%');
  $('set-rate').oninput = (e) => ($('rate-v').textContent = e.target.value);
  $('btn-save').onclick = () => {
    Object.assign(s, { daily: +$('set-daily').value || 20, retention: +$('set-ret').value, apiKey: $('set-key').value.trim(), voice: $('set-voice').value, rate: +$('set-rate').value, wbId: $('set-wb').value.trim() });
    store.save(); toast('✅ 저장되었습니다');
  };
  $('btn-test-voice').onclick = () => speak('Consistent retrieval practice makes memories last.', { rate: +$('set-rate').value });
  $('btn-pin-widget').onclick = () => {
    if (window.MemoraNative?.requestPinWidget) {
      const ok = window.MemoraNative.requestPinWidget();
      if (!ok) toast('홈 화면 빈 공간을 길게 눌러 [위젯 → Memora 단어장]을 추가해 주세요.');
    } else {
      toast('안드로이드 앱(APK)에서 실행 시 홈 화면에 위젯을 바로 추가합니다.');
    }
  };
  $('btn-refresh-widget').onclick = () => {
    store.save();
    window.MemoraNative?.refreshWidget?.();
    toast('🔄 위젯에 최신 단어장을 동기화했습니다');
  };
  $('btn-export').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([store.exportData()], { type: 'application/json' })); a.download = `memora-backup-${today()}.json`; a.click(); };
  $('imp').onchange = async (e) => { store.importData(await e.target.files[0].text()); toast('불러오기 완료'); };
  $('btn-reset').onclick = () => { if (confirm('학습 기록(복습 일정·달력)을 모두 초기화할까요? 단어는 유지됩니다.')) { store.resetProgress(); toast('초기화됨'); } };
}

// ---------- Native Widget Sync & Boot ----------
window.addEventListener('visibilitychange', () => {
  if (!document.hidden && store.pullNativeIfNewer()) router();
});
window.addEventListener('memora-native-updated', () => {
  if (store.pullNativeIfNewer()) router();
});
store.pullNativeIfNewer();
router();
syncWords(true).then((added) => { if (added || Object.keys(S().words).length) router(); });
