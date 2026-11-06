/* 전기 부품 사양 계산 모음 (화면과 분리된 순수 함수)
   - AI는 사진에서 "글자·색"만 읽고, 사양 계산은 전부 이 파일이 한다.
   - node에서 require 해서 테스트할 수 있게 마지막에 module.exports 한다. */

/* ---------- 공통 ---------- */
const SI = [[1e9,'G'],[1e6,'M'],[1e3,'k'],[1,''],[1e-3,'m'],[1e-6,'µ'],[1e-9,'n'],[1e-12,'p']];
function trimNum(x, sig = 4) {
  if (x == null || !isFinite(x)) return '-';
  if (x === 0) return '0';
  return String(parseFloat(x.toPrecision(sig)));
}
function fmtSI(v, unit, sig = 4) {
  if (v == null || !isFinite(v)) return '-';
  if (v === 0) return '0 ' + unit;
  const a = Math.abs(v);
  for (const [f, p] of SI) if (a >= f * 0.9999999) return trimNum(v / f, sig) + ' ' + p + unit;
  return trimNum(v / 1e-12, sig) + ' p' + unit;
}
function num(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : null;
}
function nums(v) { // "220/380" -> [220,380]
  if (v == null) return [];
  return (String(v).replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).map(Number);
}

/* ---------- 저항 색띠 (IEC 60062) ---------- */
const COLORS = [
  { k: 'black',  n: '검정', hex: '#1E1E1E', d: 0, m: 1,    tc: 250 },
  { k: 'brown',  n: '갈색', hex: '#7A4A2A', d: 1, m: 1e1,  tol: 1,    tc: 100 },
  { k: 'red',    n: '빨강', hex: '#D7362A', d: 2, m: 1e2,  tol: 2,    tc: 50 },
  { k: 'orange', n: '주황', hex: '#F2892B', d: 3, m: 1e3,  tol: 0.05, tc: 15 },
  { k: 'yellow', n: '노랑', hex: '#F3CF22', d: 4, m: 1e4,  tol: 0.02, tc: 25 },
  { k: 'green',  n: '초록', hex: '#2C9C4D', d: 5, m: 1e5,  tol: 0.5,  tc: 20 },
  { k: 'blue',   n: '파랑', hex: '#2E6CD6', d: 6, m: 1e6,  tol: 0.25, tc: 10 },
  { k: 'violet', n: '보라', hex: '#8A4ECF', d: 7, m: 1e7,  tol: 0.1,  tc: 5 },
  { k: 'grey',   n: '회색', hex: '#8B8B8B', d: 8, m: 1e8,  tol: 0.01, tc: 1 },
  { k: 'white',  n: '흰색', hex: '#F6F6F6', d: 9, m: 1e9 },
  { k: 'gold',   n: '금색', hex: '#C8A33A', m: 0.1,  tol: 5 },
  { k: 'silver', n: '은색', hex: '#BEC2C7', m: 0.01, tol: 10 },
  { k: 'none',   n: '없음', hex: 'none', tol: 20 },
];
const CMAP = Object.fromEntries(COLORS.map(c => [c.k, c]));
const COLOR_ALIAS = { gray: 'grey', purple: 'violet', pink: 'red', beige: 'none', tan: 'none', '': 'none' };
function normColor(c) {
  const k = String(c || '').toLowerCase().trim();
  return CMAP[k] ? k : (COLOR_ALIAS[k] ?? k);
}
/* 띠 위치별 역할 */
function bandRoles(n) {
  return { 3: ['d', 'd', 'm'], 4: ['d', 'd', 'm', 't'], 5: ['d', 'd', 'd', 'm', 't'], 6: ['d', 'd', 'd', 'm', 't', 'tc'] }[n];
}
function colorsFor(role, first) {
  return COLORS.filter(c =>
    role === 'd' ? c.d != null && !(first && c.d === 0) :
    role === 'm' ? c.m != null :
    role === 't' ? c.tol != null :
    c.tc != null);
}
function decodeBands(bands) {
  const b = bands.map(normColor);
  const roles = bandRoles(b.length);
  if (!roles) return { ok: false, err: '색띠는 3~6줄이어야 해요' };
  let digits = '', mult = null, tol = 20, tc = null;
  for (let i = 0; i < b.length; i++) {
    const c = CMAP[b[i]];
    if (!c) return { ok: false, err: `${i + 1}번째 색을 모르겠어요 (${bands[i]})` };
    const r = roles[i];
    if (r === 'd') { if (c.d == null) return { ok: false, err: `${i + 1}번째 띠(숫자)에 ${c.n}은 올 수 없어요` }; digits += c.d; }
    if (r === 'm') { if (c.m == null) return { ok: false, err: `${i + 1}번째 띠(배수)에 ${c.n}은 올 수 없어요` }; mult = c.m; }
    if (r === 't') { if (c.tol == null) return { ok: false, err: `${i + 1}번째 띠(오차)에 ${c.n}은 올 수 없어요` }; tol = c.tol; }
    if (r === 'tc') { if (c.tc == null) return { ok: false, err: `${i + 1}번째 띠(온도계수)에 ${c.n}은 올 수 없어요` }; tc = c.tc; }
  }
  const ohm = Math.round(parseInt(digits, 10) * mult * 1e6) / 1e6;
  return { ok: true, ohm, tol, tc, min: ohm * (1 - tol / 100), max: ohm * (1 + tol / 100), bands: b };
}
/* 사진에서는 어느 쪽이 첫 띠인지 모를 수 있다 → 안 맞으면 뒤집어 본다 */
function autoOrient(bands) {
  const b = bands.map(normColor);
  const a = decodeBands(b);
  const firstBad = ['gold', 'silver', 'none'].includes(b[0]);
  if (a.ok && !firstBad) return { bands: b, flipped: false };
  const r = b.slice().reverse();
  const rr = decodeBands(r);
  if (rr.ok) return { bands: r, flipped: true };
  return { bands: b, flipped: false };
}
function valueToBands(ohm, n) {
  if (!(ohm > 0)) return { ok: false, err: '0보다 큰 값을 넣어 주세요' };
  const sig = n >= 5 ? 3 : 2;
  let e = Math.floor(Math.log10(ohm) + 1e-9) - (sig - 1);
  let mant = Math.round(ohm / Math.pow(10, e) * 1e6) / 1e6;
  let exact = Math.abs(mant - Math.round(mant)) < 1e-6;
  mant = Math.round(mant);
  if (mant >= Math.pow(10, sig)) { mant /= 10; e++; }
  if (e < -2 || e > 9) return { ok: false, err: `${n}줄 색띠로 나타낼 수 없는 크기예요` };
  const multK = COLORS.find(c => c.m != null && Math.abs(Math.log10(c.m) - e) < 1e-9).k;
  const ds = String(mant).padStart(sig, '0').split('').map(d => COLORS.find(c => c.d === +d).k);
  const bands = [...ds, multK];
  if (n >= 4) bands.push(n === 4 ? 'gold' : 'brown');
  if (n === 6) bands.push('brown');
  return { ok: true, bands, exact, shown: mant * Math.pow(10, e) };
}

/* ---------- 문자로 쓴 저항값 "4.7k", "4k7", "1M", "470R" ---------- */
function parseOhm(s) {
  let t = String(s || '').trim().replace(/\s/g, '').replace(/[ΩΩ]|ohms?|옴/gi, '');
  if (!t) return null;
  let m = t.match(/^(\d+)([RKMG])(\d+)$/i);          // 4k7, 4R7
  if (m) { const f = { R: 1, K: 1e3, M: 1e6, G: 1e9 }[m[2].toUpperCase()]; return parseFloat(m[1] + '.' + m[3]) * f; }
  m = t.match(/^(\d*\.?\d+)([RKMG]?)$/i);
  if (m) { const f = { '': 1, R: 1, K: 1e3, M: 1e6, G: 1e9 }[m[2].toUpperCase()]; return parseFloat(m[1]) * f; }
  return null;
}

/* ---------- SMD 저항 코드 ---------- */
const E96 = [100,102,105,107,110,113,115,118,121,124,127,130,133,137,140,143,147,150,154,158,162,165,169,174,178,182,187,191,196,200,205,210,215,221,226,232,237,243,249,255,261,267,274,280,287,294,301,309,316,324,332,340,348,357,365,374,383,392,402,412,422,432,442,453,464,475,487,499,511,523,536,549,562,576,590,604,619,634,649,665,681,698,715,732,750,768,787,806,825,845,866,887,909,931,953,976];
const E12 = [10,12,15,18,22,27,33,39,47,56,68,82];
const E24 = [10,11,12,13,15,16,18,20,22,24,27,30,33,36,39,43,47,51,56,62,68,75,82,91];
const EIA96_MULT = { Z: 0.001, Y: 0.01, R: 0.01, X: 0.1, S: 0.1, A: 1, B: 10, H: 10, C: 100, D: 1e3, E: 1e4, F: 1e5 };
function decodeSMD(code) {
  const c = String(code || '').toUpperCase().replace(/[\s_\-]/g, '');
  if (!c) return { ok: false, err: '코드를 넣어 주세요' };
  if (/^0+$/.test(c)) return { ok: true, ohm: 0, kind: '점퍼(0Ω)', tol: null, note: '저항이 아니라 회로를 잇는 0Ω 점퍼예요' };
  let m = c.match(/^(\d*)R(\d*)$/);
  if (m && (m[1] || m[2])) return { ok: true, ohm: parseFloat((m[1] || '0') + '.' + (m[2] || '0')), kind: 'R 표기', tol: c.length >= 4 ? 1 : 5, note: 'R은 소수점 자리예요 (4R7 = 4.7Ω)' };
  m = c.match(/^(\d+)M(\d+)$/);
  if (m) return { ok: true, ohm: parseFloat(m[1] + '.' + m[2]) / 1000, kind: 'm 표기(전류 감지용)', tol: 1, note: 'M(m)은 밀리옴 소수점 자리예요 (1M5 = 1.5mΩ)' };
  if (/^\d{3}$/.test(c)) return { ok: true, ohm: +c.slice(0, 2) * Math.pow(10, +c[2]), kind: '3자리 코드', tol: 5, note: '앞 2자리 숫자 × 10^(마지막 자리). 100은 100Ω이 아니라 10Ω이에요' };
  if (/^\d{4}$/.test(c)) return { ok: true, ohm: +c.slice(0, 3) * Math.pow(10, +c[3]), kind: '4자리 코드', tol: 1, note: '앞 3자리 숫자 × 10^(마지막 자리)' };
  m = c.match(/^(\d{2})([A-Z])$/);
  if (m) {
    const i = +m[1], f = EIA96_MULT[m[2]];
    if (i >= 1 && i <= 96 && f != null) return { ok: true, ohm: Math.round(E96[i - 1] * f * 1e6) / 1e6, kind: 'EIA-96 코드', tol: 1, note: `${m[1]}번 = ${E96[i - 1]}, ${m[2]} = ×${f}` };
  }
  return { ok: false, err: '알 수 없는 코드예요 (예: 103, 4R7, 1002, 01C)' };
}
function eSeries(ohm) {
  if (!(ohm > 0)) return [];
  const e = Math.floor(Math.log10(ohm) + 1e-9);
  const m2 = Math.round(ohm / Math.pow(10, e - 1) * 1e4) / 1e4;
  const m3 = Math.round(ohm / Math.pow(10, e - 2) * 1e4) / 1e4;
  const out = [];
  if (E12.includes(m2)) out.push('E12');
  if (E24.includes(m2)) out.push('E24');
  if (E96.includes(m3)) out.push('E96');
  return out;
}

/* ---------- 콘덴서 표기 ---------- */
const CAP_TOL = { B: '±0.1pF', C: '±0.25pF', D: '±0.5pF', F: '±1%', G: '±2%', J: '±5%', K: '±10%', M: '±20%', Z: '+80% / −20%' };
const VCODE = { '0G': 4, '0J': 6.3, '1A': 10, '1C': 16, '1D': 20, '1E': 25, '1V': 35, '1H': 50, '1J': 63, '1K': 80, '2A': 100, '2Q': 110, '2B': 125, '2C': 160, '2D': 200, '2P': 220, '2E': 250, '2F': 315, '2V': 350, '2G': 400, '2W': 450, '2H': 500, '2J': 630, '3A': 1000 };
const DIE_LOW = { X: -55, Y: -30, Z: 10 };
const DIE_HIGH = { 2: 45, 4: 65, 5: 85, 6: 105, 7: 125, 8: 150, 9: 200 };
const DIE_CHG = { A: '±1.0%', B: '±1.5%', C: '±2.2%', D: '±3.3%', E: '±4.7%', F: '±7.5%', P: '±10%', R: '±15%', S: '±22%', T: '+22% / −33%', U: '+22% / −56%', V: '+22% / −82%' };
function decodeDielectric(d) {
  if (!d) return null;
  const u = d.toUpperCase().replace('O', '0');
  if (u === 'C0G' || u === 'NP0') return { name: d.toUpperCase(), cls: '1종(온도 보상형)', text: '온도가 변해도 용량이 거의 그대로예요 (0 ±30ppm/°C). 필터·발진 회로용' };
  const m = u.match(/^([XYZ])(\d)([A-V])$/);
  if (!m || DIE_LOW[m[1]] == null || DIE_HIGH[m[2]] == null || !DIE_CHG[m[3]]) return null;
  return { name: u, cls: '2종(고유전율형)', text: `${DIE_LOW[m[1]]}°C ~ +${DIE_HIGH[m[2]]}°C에서 용량 변화 ${DIE_CHG[m[3]]}` };
}
function normUnits(s) {
  return String(s || '').replace(/[µμ]/g, 'u').replace(/㎌/g, 'uF').replace(/㎋/g, 'nF').replace(/㎊/g, 'pF').replace(/㎐/g, 'Hz').replace(/㎾/g, 'kW').trim();
}
function parseCap(text) {
  const t = normUnits(text);
  const r = { pF: null, tol: null, tolLetter: null, volt: null, vType: null, vCode: null, die: null, how: '' };
  if (!t) return r;
  let m;
  m = t.match(/\b(C0G|COG|NP0|NPO|[XYZ]\d[A-V])\b/i);
  if (m) r.die = decodeDielectric(m[1]);
  // 전압: 50V, 450VAC, 1kV, 25WV
  m = t.match(/(\d+(?:\.\d+)?)\s*(k)?\s*(?:V|WV)\s*(AC|DC|~)?/i);
  if (m) { r.volt = parseFloat(m[1]) * (m[2] ? 1000 : 1); r.vType = m[3] ? (/AC|~/i.test(m[3]) ? 'AC' : 'DC') : null; }
  // 단위가 붙은 값: 470uF, 0.1uF, 35MFD
  m = t.match(/(\d+(?:\.\d+)?)\s*MFD\b/i);
  if (m) { r.pF = parseFloat(m[1]) * 1e6; r.how = 'MFD는 µF의 옛 표기예요'; }
  if (r.pF == null) {
    m = t.match(/(\d*\.?\d+)\s*(p|n|u|m)?F(?![a-z])/i);
    if (m) { const f = { p: 1, n: 1e3, u: 1e6, m: 1e9 }[(m[2] || '').toLowerCase()] ?? 1e12; r.pF = parseFloat(m[1]) * f; r.how = '용량이 단위와 함께 적혀 있어요'; }
  }
  // 4n7, 2p2, 1u0
  if (r.pF == null) {
    m = t.match(/(?:^|[^\w.])(\d+)([pnu])(\d+)(?![\w.])/i);
    if (m) { const f = { p: 1, n: 1e3, u: 1e6 }[m[2].toLowerCase()]; r.pF = parseFloat(m[1] + '.' + m[3]) * f; r.how = `글자(${m[2]})가 소수점 자리예요`; }
  }
  // 2A473J 처럼 전압 코드 + 3자리 + 오차
  if (r.pF == null) {
    m = t.match(/(?:^|[^\w])([0-3][A-Z])\s*(\d{3})([BCDFGJKMZ])?(?![\w.])/i);
    if (m && VCODE[m[1].toUpperCase()] != null) {
      r.vCode = m[1].toUpperCase(); if (r.volt == null) { r.volt = VCODE[r.vCode]; r.vType = 'DC'; }
      r.pF = capCode(m[2]); if (m[3]) r.tolLetter = m[3].toUpperCase();
      r.how = `${r.vCode} = ${VCODE[r.vCode]}V, ${m[2]} = 앞 2자리 × 10^(마지막 자리) pF`;
    }
  }
  // 104, 104K
  if (r.pF == null) {
    m = t.match(/(?:^|[^\w.])(\d{3})([BCDFGJKMZ])?(?![\d.]|\s*k?\s*W?V|\s*[pnu]?F)/i);
    if (m) { r.pF = capCode(m[1]); if (m[2]) r.tolLetter = m[2].toUpperCase(); r.how = `${m[1]} = 앞 2자리 × 10^(마지막 자리) pF`; }
  }
  // 47 → 47pF (숫자만 1~2자리)
  if (r.pF == null) {
    m = t.match(/^(\d{1,2})([BCDFGJKMZ])?$/i);
    if (m) { r.pF = +m[1]; if (m[2]) r.tolLetter = m[2].toUpperCase(); r.how = '두 자리 이하 숫자는 그대로 pF예요'; }
  }
  if (r.tolLetter == null) { m = t.match(/(?:^|[\s\/])([BCDFGJKMZ])(?:\s|$)/i); if (m) r.tolLetter = m[1].toUpperCase(); }
  m = t.match(/±\s*(\d+(?:\.\d+)?)\s*%/); if (m) r.tol = '±' + m[1] + '%';
  if (r.tolLetter && !r.tol) r.tol = CAP_TOL[r.tolLetter] || null;
  return r;
}
function capCode(s) {
  const a = +s.slice(0, 2), e = +s[2];
  const f = e === 8 ? 0.01 : e === 9 ? 0.1 : Math.pow(10, e);
  return Math.round(a * f * 1e6) / 1e6;
}
function reactanceC(pF, f) { return (pF > 0 && f > 0) ? 1 / (2 * Math.PI * f * pF * 1e-12) : null; }

/* ---------- 인덕터 ---------- */
function parseInd(text) {
  const t = normUnits(text).replace(/\s/g, '');
  let m = t.match(/(\d*\.?\d+)(n|u|m)?H(?![a-z])/i);
  if (m) { const f = { n: 1e-3, u: 1, m: 1e3 }[(m[2] || '').toLowerCase()] ?? 1e6; return { uH: parseFloat(m[1]) * f, how: '값이 단위와 함께 적혀 있어요' }; }
  m = t.match(/^(\d*)R(\d+)/i);
  if (m) return { uH: parseFloat((m[1] || '0') + '.' + m[2]), how: 'R은 소수점 자리예요 (단위 µH)' };
  m = t.match(/^(\d{3})([JKLM])?$/i);
  if (m) return { uH: +m[1].slice(0, 2) * Math.pow(10, +m[1][2]), how: `${m[1]} = 앞 2자리 × 10^(마지막 자리) µH`, tol: m[2] ? ({ J: '±5%', K: '±10%', L: '±15%', M: '±20%' })[m[2].toUpperCase()] : null };
  return { uH: null };
}
function reactanceL(uH, f) { return (uH > 0 && f > 0) ? 2 * Math.PI * f * uH * 1e-6 : null; }

/* ---------- 모터 명판 ---------- */
const INS_CLASS = { A: 105, E: 120, B: 130, F: 155, H: 180 };
const IP1 = ['보호 없음', '50mm 이상 물체(손등)', '12.5mm 이상 물체(손가락)', '2.5mm 이상 물체(공구)', '1mm 이상 물체(가는 전선)', '먼지 보호(약간 들어가도 동작엔 지장 없음)', '먼지 완전 차단'];
const IP2 = ['보호 없음', '수직으로 떨어지는 물방울', '15° 기울어도 떨어지는 물방울', '비처럼 뿌리는 물(60°까지)', '모든 방향에서 튀는 물', '노즐로 쏘는 물', '강한 물줄기', '일시적 침수(1m, 30분)', '계속 잠겨도 됨(제조사 조건)', '고압·고온 물 세척'];
function decodeIP(s) {
  const m = String(s || '').toUpperCase().match(/IP\s*([0-6X])([0-9X])(K)?/);
  if (!m) return null;
  return { code: 'IP' + m[1] + m[2] + (m[3] || ''), solid: m[1] === 'X' ? '시험 안 함' : IP1[+m[1]], water: m[2] === 'X' ? '시험 안 함' : IP2[+m[2]] };
}
const DUTY = { S1: '연속 사용(정격 출력으로 계속 돌려도 됨)', S2: '단시간 사용(정해진 시간만 돌리고 식혀야 함)', S3: '반복 단속 사용(켜고 끄기를 일정 비율로 반복)' };
function motorCalc(i) {
  const out = { rows: [], notes: [], warn: [] };
  const ph = i.phase === 1 ? 1 : 3;
  const volts = nums(i.voltage), amps = nums(i.current);
  const k = Math.min(i.sel ?? volts.length - 1, Math.max(volts.length - 1, 0));
  const V = volts[k] ?? null;
  const I = amps.length ? (amps[Math.min(k, amps.length - 1)]) : null;
  const f = num(i.freq) || 60;
  let P = num(i.kw);
  const hp = num(i.hp);
  if (P == null && hp != null) P = hp * 0.746;
  let poles = num(i.poles);
  const rpm = num(i.rpm);
  let eff = num(i.eff); if (eff != null && eff > 1) eff /= 100;
  let pf = num(i.pf); if (pf != null && pf > 1) pf /= 100;

  if (poles == null && rpm) { poles = 2 * Math.floor(60 * f / rpm); out.notes.push(`극수는 회전수(${rpm}rpm)로 추정했어요`); }
  const Ns = poles ? 120 * f / poles : null;
  const slip = (Ns && rpm) ? (Ns - rpm) / Ns : null;
  const S = (V && I) ? (ph === 3 ? Math.sqrt(3) : 1) * V * I : null;
  let effE = eff, pfE = pf;
  if (P && S) {
    if (eff != null && pf == null) pfE = P * 1000 / eff / S;
    if (pf != null && eff == null) effE = P * 1000 / (S * pf);
  }
  let Iest = null;
  if (P && V && !I) {
    const e = eff ?? 0.85, p = pf ?? 0.85;
    Iest = P * 1000 / ((ph === 3 ? Math.sqrt(3) : 1) * V * e * p);
    if (eff == null || pf == null) out.notes.push('정격 전류는 효율·역률을 85%로 가정해서 추정했어요');
  }
  const Pin = (P && effE) ? P / effE : null;
  const T = (P && (rpm || Ns)) ? 9549.3 * P / (rpm || Ns) : null;

  if (P != null) out.rows.push(['정격 출력', `${trimNum(P)} kW` + (hp == null ? ` (≈ ${trimNum(P / 0.746, 3)} HP)` : ` (${trimNum(hp)} HP)`)]);
  if (V) out.rows.push(['사용 전압', `${ph === 3 ? '3상' : '단상'} ${V} V, ${f} Hz`]);
  if (I) out.rows.push(['정격 전류', `${I} A`]);
  if (Iest) out.rows.push(['정격 전류(추정)', `약 ${trimNum(Iest, 3)} A`]);
  if (poles) out.rows.push(['극수', `${poles}극`]);
  if (Ns) out.rows.push(['동기 속도', `${trimNum(Ns)} rpm  (= 120 × ${f} ÷ ${poles})`]);
  if (rpm) out.rows.push(['정격 회전수', `${rpm} rpm`]);
  if (slip != null) out.rows.push(['슬립', `${trimNum(slip * 100, 3)} %`]);
  if (T) out.rows.push(['정격 토크', `${trimNum(T, 3)} N·m  (≈ ${trimNum(T / 9.80665, 3)} kgf·m)`]);
  if (S) out.rows.push(['피상 전력', `${trimNum(S / 1000, 3)} kVA`]);
  if (Pin) out.rows.push(['입력 전력', `${trimNum(Pin, 3)} kW`]);
  if (effE != null) out.rows.push(['효율', `${trimNum(effE * 100, 3)} %` + (eff == null ? ' (계산값)' : '')]);
  if (pfE != null) out.rows.push(['역률', `${trimNum(pfE, 3)}` + (pf == null ? ' (계산값)' : '')]);
  if (effE != null && (effE > 1 || effE < 0.3)) out.warn.push('효율 계산값이 이상해요. 전압·전류·출력 값을 다시 확인해 주세요');
  if (pfE != null && (pfE > 1 || pfE < 0.3)) out.warn.push('역률 계산값이 이상해요. 전압·전류·효율 값을 다시 확인해 주세요');
  const ins = String(i.ins || '').toUpperCase().trim();
  if (INS_CLASS[ins]) out.rows.push(['절연 등급', `${ins}종: 권선 최고 허용 온도 ${INS_CLASS[ins]}°C`]);
  const ip = decodeIP(i.ip);
  if (ip) out.rows.push(['보호 등급', `${ip.code}: 고체 ${ip.solid} / 물 ${ip.water}`]);
  const du = String(i.duty || '').toUpperCase().match(/S[1-3]/);
  if (du) out.rows.push(['사용률', `${du[0]}: ${DUTY[du[0]]}`]);
  const sf = num(i.sf);
  if (sf) out.rows.push(['SF(서비스 팩터)', `${sf}: 정격의 ${trimNum(sf * 100)}%까지 잠깐 과부하 허용`]);
  if (volts.length > 1) {
    const con = String(i.conn || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean);
    out.notes.push('전압이 여러 개면 결선에 따라 달라요: ' + volts.map((v, j) => `${v}V${con[j] ? ' ' + con[j] + '결선' : ''}${amps[j] ? ' → ' + amps[j] + 'A' : ''}`).join(', '));
  }
  const In = I || Iest;
  if (In) out.notes.push(`직입 기동하면 순간 전류가 보통 정격의 5~8배(약 ${Math.round(In * 5)}~${Math.round(In * 8)} A)까지 흘러요. 정확한 값은 제조사 자료를 보세요`);
  return { ...out, V, I: In, P, poles, Ns, T, volts, sel: k };
}

/* ---------- 차단기 ---------- */
const CURVE = { B: [3, 5, '전등·전열 등 기동 전류가 작은 부하'], C: [5, 10, '일반 배선·소형 모터'], D: [10, 20, '변압기·큰 모터처럼 기동 전류가 큰 부하'] };
const BREAKER_KIND = {
  MCB: '소형 배선용 차단기(MCB). 분전반 개별 회로용, 과전류·단락을 끊어요',
  MCCB: '배선용 차단기(MCCB). 과부하와 단락(합선)을 끊고, 누전은 감지하지 않아요',
  ELB: '누전 차단기(ELB·RCBO). 과전류에 더해 누전(지락)도 끊어요',
};
function breakerCalc(i) {
  const rows = [], notes = [];
  const In = num(i.in), AF = num(i.af), kA = num(i.ka), mA = num(i.ma), V = num(i.v);
  const kind = BREAKER_KIND[i.kind] ? i.kind : null;
  if (kind) rows.push(['종류', BREAKER_KIND[kind]]);
  if (i.poles) rows.push(['극수', `${i.poles}P: ${({ 1: '단상 1선', 2: '단상 2선(L·N)', 3: '3상 3선', 4: '3상 4선(R·S·T·N)' })[i.poles] || ''}`]);
  if (In) rows.push(['정격 전류(AT)', `${In} A: 이보다 큰 전류가 계속 흐르면 시간을 두고 끊어요`]);
  if (AF) rows.push(['프레임(AF)', `${AF} AF: 차단기 몸체 크기. 같은 프레임 안에서 정격 전류를 골라 써요`]);
  if (AF && In && In > AF) notes.push('정격 전류(AT)가 프레임(AF)보다 커요. 값을 다시 확인해 주세요');
  const c = CURVE[String(i.curve || '').toUpperCase()];
  if (c) rows.push([`${i.curve.toUpperCase()} 곡선`, `정격의 ${c[0]}~${c[1]}배` + (In ? ` (${In * c[0]}~${In * c[1]} A)` : '') + `에서 즉시 차단. ${c[2]}`]);
  if (kA) rows.push(['차단 용량', `${kA} kA: 합선 때 이 전류까지 안전하게 끊을 수 있어요. 설치 위치의 단락 전류보다 커야 해요`]);
  if (mA) rows.push(['정격 감도 전류', `${mA} mA` + (mA <= 30 ? ': 고감도형(사람 감전 보호용). 인체 보호용은 보통 0.03초 이내 동작' : mA <= 1000 ? ': 중감도형(설비·화재 보호용)' : '')]);
  if (V) rows.push(['정격 전압', `${V} V`]);
  if (In && V) {
    const ph = i.poles >= 3 ? 3 : 1;
    rows.push(['걸 수 있는 부하(참고)', `약 ${trimNum((ph === 3 ? Math.sqrt(3) : 1) * V * In / 1000, 3)} kVA (${ph === 3 ? '3상' : '단상'}, 정격 전류 기준 최대치)`]);
    notes.push('실제로는 정격 전류의 80% 안쪽으로 쓰는 경우가 많아요');
  }
  return { rows, notes };
}

/* ---------- 전선 ---------- */
const WIRE_TYPES = {
  'HFIX': '450/750V 저독성 난연 가교 폴리올레핀 절연전선. 실내 배관 배선에 가장 많이 쓰는 단심 전선',
  'HFIO': '450/750V 저독성 난연 폴리올레핀 절연전선',
  'IV': '600V 비닐 절연전선(옛 규격). 지금은 HFIX 등으로 바뀌었어요',
  'HIV': '600V 2종 비닐 절연전선(내열, 옛 규격)',
  'F-CV': '0.6/1kV 가교 폴리에틸렌 절연 비닐 시스 난연 케이블. 간선·동력 배선용',
  'CV': '0.6/1kV 가교 폴리에틸렌 절연 비닐 시스 케이블',
  'HFCO': '0.6/1kV 저독성 난연 폴리올레핀 시스 전력 케이블(F-CV보다 연기·유독가스가 적음)',
  'FR-CV': '0.6/1kV 내화 케이블. 화재 때도 일정 시간 전기를 보내야 하는 소방 설비용',
  'TFR-CV': '0.6/1kV 트레이용 난연 케이블',
  'VCTF': '비닐 캡타이어 코드. 전기 기기 전원 코드처럼 자주 움직이는 곳에 쓰는 연선 코드',
  'VCT': '비닐 캡타이어 케이블. 이동용 기계·공구 전원용',
  'VV': '0.6/1kV 비닐 절연 비닐 시스 케이블',
  'GV': '접지용 비닐 절연전선(초록/초록-노랑)',
  'OW': '옥외용 비닐 절연전선. 배전선로용',
  'DV': '인입용 비닐 절연전선. 전봇대에서 건물로 들어오는 선',
};
const WIRE_SIZES = [0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];
// IEC 60228 2종(연선) 구리 도체 20°C 최대 저항 Ω/km
const WIRE_R = { 0.75: 24.5, 1: 18.1, 1.5: 12.1, 2.5: 7.41, 4: 4.61, 6: 3.08, 10: 1.83, 16: 1.15, 25: 0.727, 35: 0.524, 50: 0.387, 70: 0.268, 95: 0.193, 120: 0.153, 150: 0.124, 185: 0.0991, 240: 0.0754, 300: 0.0601 };
function parseWire(text) {
  const t = normUnits(text).toUpperCase().replace(/\s+/g, ' ');
  const r = { kind: null, sq: null, cores: null, volt: null };
  const keys = Object.keys(WIRE_TYPES).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    const re = new RegExp('(^|[^A-Z-])' + k.replace('-', '-?') + '(?![A-Z])');
    if (re.test(t)) { r.kind = k; break; }
  }
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:SQ|MM2|MM²|㎟|MM\^2)/);
  if (m) r.sq = parseFloat(m[1]);
  m = t.match(/(\d+)\s*C\b/) || t.match(/(\d+)\s*[X×*]\s*\d+(?:\.\d+)?\s*(?:SQ|MM)/);
  if (m) r.cores = +m[1];
  m = t.match(/(0\.6\/1|450\/750|300\/500|\d+(?:\.\d+)?)\s*KV\b/) || t.match(/(\d+)\s*V\b/);
  if (m) r.volt = m[0].trim();
  return r;
}
const VDROP = { '1p2w': [35.6, '단상 2선식'], '3p3w': [30.8, '3상 3선식'], '3p4w': [17.8, '단상 3선식·3상 4선식(대지 전압 기준)'] };
function voltageDrop(sys, L, I, A, V) {
  const k = VDROP[sys]; if (!k || !(L > 0) || !(I > 0) || !(A > 0)) return null;
  const e = k[0] * L * I / (1000 * A);
  return { e, pct: V > 0 ? e / V * 100 : null, k: k[0], name: k[1] };
}

if (typeof module !== 'undefined') module.exports = {
  fmtSI, trimNum, num, nums, COLORS, CMAP, normColor, bandRoles, colorsFor, decodeBands, autoOrient, valueToBands,
  parseOhm, decodeSMD, eSeries, E96, parseCap, decodeDielectric, CAP_TOL, VCODE, reactanceC, parseInd, reactanceL,
  motorCalc, decodeIP, INS_CLASS, breakerCalc, BREAKER_KIND, CURVE, parseWire, WIRE_TYPES, WIRE_SIZES, WIRE_R, voltageDrop, VDROP,
};
