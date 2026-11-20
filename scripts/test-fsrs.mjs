import { review } from '../src/lib/fsrs.js';
let c = {}; let now = Date.now(); const out = [];
for (let i = 0; i < 6; i++) { c = review(c, 3, now); out.push(c.interval); now += c.interval * 86400000; }
console.log('Good 연속 간격(일):', out.join(' → '));
