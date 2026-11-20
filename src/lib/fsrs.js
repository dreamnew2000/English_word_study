// FSRS-5 (Free Spaced Repetition Scheduler) — DSR 모델 구현
// R(t,S) = (1 + F·t/S)^C ,  F = 19/81, C = -0.5
export const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5;
const FACTOR = 19 / 81;
export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 };

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export const retrievability = (t, S) => Math.pow(1 + (FACTOR * t) / S, DECAY);
export const nextInterval = (S, retention = 0.9) =>
  clamp(Math.round((S / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1)), 1, 36500);

const initD = (g) => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);
const initS = (g) => Math.max(W[g - 1], 0.1);

function nextD(D, g) {
  const delta = -W[6] * (g - 3);
  const damped = D + (delta * (10 - D)) / 9; // linear damping
  return clamp(W[7] * initD(4) + (1 - W[7]) * damped, 1, 10); // mean reversion
}

function recallS(D, S, R, g) {
  const hard = g === 2 ? W[15] : 1;
  const easy = g === 4 ? W[16] : 1;
  return S * (Math.exp(W[8]) * (11 - D) * Math.pow(S, -W[9]) * (Math.exp(W[10] * (1 - R)) - 1) * hard * easy + 1);
}

function forgetS(D, S, R) {
  return Math.min(S, W[11] * Math.pow(D, -W[12]) * (Math.pow(S + 1, W[13]) - 1) * Math.exp(W[14] * (1 - R)));
}

/** card: {S, D, last(ms), reps, lapses}  → returns updated card with interval (days) */
export function review(card, g, now = Date.now(), retention = 0.9) {
  const c = { ...card };
  if (!c.reps) {
    c.D = initD(g);
    c.S = initS(g);
  } else {
    const t = Math.max(0, (now - c.last) / 86400000);
    const R = retrievability(t, c.S);
    c.D = nextD(c.D, g);
    if (g === 1) { c.S = forgetS(card.D, c.S, R); c.lapses = (c.lapses || 0) + 1; }
    else c.S = recallS(card.D, c.S, R, g);
  }
  c.reps = (c.reps || 0) + 1;
  c.last = now;
  c.interval = g === 1 ? 1 : nextInterval(c.S, retention);
  return c;
}
