/* 부품 사양 찾기 — AI 중계 서버 (Cloudflare Worker)
   역할: 앱이 보낸 사진을 Gemini에게 전달하고, 읽은 값을 JSON으로 돌려준다.
   - API 키(GEMINI_API_KEY)는 Cloudflare의 Secret에만 있고, 앱 코드에는 없다.
   - 계산은 하지 않는다. AI는 "보이는 글자와 색"만 읽고, 사양 계산은 앱의 calc.js가 한다.

   Cloudflare 설정
   - Secret:   GEMINI_API_KEY  (Google AI Studio에서 발급)
   - 변수(선택): ALLOWED_ORIGINS = "https://leehidecember.github.io"  (쉼표로 여러 개)
               MODEL = "gemini-flash-latest"  (모델 이름이 바뀌면 여기만 고치면 됨)
*/

const PROMPT = `You read photos of electrical components for Korean electrical students and technicians.
Identify the single main component in the photo and transcribe what is VISIBLE. Do not compute specs and do not guess values that are not visible; use null instead.

Return ONLY JSON with this shape:
{
  "type": "resistor_color" | "resistor_smd" | "capacitor" | "inductor" | "motor" | "breaker" | "wire" | "unknown",
  "confidence": number 0..1,
  "bands": [color names in order starting from the band nearest one end, for color-banded resistors/inductors] or null,
  "marking": "the code/marking printed on a small part or cable exactly as written (e.g. \\"103\\", \\"2A473J\\", \\"470uF 25V\\", \\"F-CV 0.6/1kV 4C X 6SQ\\")" or null,
  "motor": { "phase": 1|3|null, "voltage": "e.g. 220/380" , "current": "e.g. 26.4/15.2", "power_kw": number|null, "power_hp": number|null, "freq": number|null, "poles": number|null, "rpm": number|null, "efficiency": number (percent)|null, "power_factor": number|null, "insulation": "A|E|B|F|H"|null, "ip": "IP55"|null, "duty": "S1"|null, "sf": number|null, "connection": "e.g. Δ/Y"|null } or null,
  "breaker": { "kind": "MCB"|"MCCB"|"ELB"|null, "poles": number|null, "rated_current": number|null, "frame": number|null, "curve": "B"|"C"|"D"|null, "breaking_ka": number|null, "sensitivity_ma": number|null, "voltage": number|null } or null,
  "raw_text": "all readable text in the photo, line breaks as \\n",
  "note": "one or two short sentences IN KOREAN about anything uncertain (blurry, glare, band order unclear). Empty string if nothing."
}

Rules:
- Band colors must be one of: black, brown, red, orange, yellow, green, blue, violet, grey, white, gold, silver, none. List bands in physical order. If one end has a gold/silver band or a wider gap, start from the OTHER end.
- A component with color bands that looks like a resistor but is green/blue-bodied and fat may be an inductor; use "inductor" only if clearly an inductor.
- SMD resistors show 3-4 characters (103, 4R7, 1002, 01C) → "resistor_smd" with that code in "marking".
- Capacitors and inductors: put the printed code in "marking". Leave the interpretation to the app.
- Breakers: ELB/RCBO/RCD/누전 → "ELB"; small DIN-rail MCB with C16/B10 style → "MCB"; molded case 배선용 → "MCCB". AT = rated_current, AF = frame, IΔn = sensitivity_ma, Icu/Icn kA = breaking_ka.
- Motors: copy multiple voltages/currents exactly with "/" (e.g. "220/380"). HP and kW are both allowed.
- Cables/wires: copy the printed marking.`;

const TYPES_HINT = {
  resistor: 'The user says this is a resistor (color bands or SMD code).',
  capacitor: 'The user says this is a capacitor.',
  inductor: 'The user says this is an inductor.',
  motor: 'The user says this is a motor nameplate.',
  breaker: 'The user says this is a circuit breaker.',
  wire: 'The user says this is an electric wire or cable marking.',
};

// 같은 Worker 인스턴스 안에서만 세는 간단한 횟수 제한 (완벽하진 않지만 연속 호출은 막아 준다)
const hits = new Map();
function tooMany(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60000);
  list.push(now); hits.set(ip, list);
  return list.length > 10;
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || 'https://leehidecember.github.io').split(',').map(s => s.trim());
    const okOrigin = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    const model = env.MODEL || 'gemini-flash-latest';

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    // 상태 확인: 값은 절대 보여 주지 않고, 설정된 변수 '이름'만 보여 준다 (오타 찾기용)
    if (req.method === 'GET') return json({ ok: true, model, keySet: !!env.GEMINI_API_KEY, names: Object.keys(env) });
    if (req.method !== 'POST') return json({ ok: false, error: '허용되지 않은 요청이에요' }, 405);
    // 다른 웹사이트의 브라우저에서 이 서버를 쓰지 못하게 (브라우저가 보내는 Origin 기준)
    if (!okOrigin) return json({ ok: false, error: '허용되지 않은 주소에서 온 요청이에요' }, 403);
    if (!env.GEMINI_API_KEY) return json({ ok: false, error: '서버에 GEMINI_API_KEY가 설정되지 않았어요' }, 500);
    if (+(req.headers.get('Content-Length') || 0) > 4_000_000) return json({ ok: false, error: '사진이 너무 커요' }, 413);
    if (tooMany(req.headers.get('CF-Connecting-IP') || 'x')) return json({ ok: false, error: '잠시 후 다시 시도해 주세요 (1분에 10번까지)' }, 429);

    let body;
    try { body = await req.json(); } catch { return json({ ok: false, error: '잘못된 요청이에요' }, 400); }
    const { image, mime = 'image/jpeg', hint = 'auto' } = body || {};
    if (typeof image !== 'string' || image.length < 100) return json({ ok: false, error: '사진이 없어요' }, 400);

    const text = PROMPT + (TYPES_HINT[hint] ? '\n\n' + TYPES_HINT[hint] : '');
    const gReq = {
      contents: [{ role: 'user', parts: [{ text }, { inline_data: { mime_type: mime, data: image } }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    };
    let g;
    try {
      g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify(gReq),
      });
    } catch (e) { return json({ ok: false, error: 'AI 서버에 연결하지 못했어요' }, 502); }

    const gj = await g.json().catch(() => ({}));
    if (!g.ok) {
      const msg = g.status === 429 ? '오늘 무료 사용량을 다 썼거나 너무 자주 요청했어요. 잠시 후 다시 시도해 주세요'
        : g.status === 404 ? `모델(${model})을 찾을 수 없어요. Worker의 MODEL 변수를 확인해 주세요`
        : (gj.error && gj.error.message) || 'AI 오류';
      return json({ ok: false, error: msg }, g.status === 429 ? 429 : 502);
    }
    const parts = gj.candidates?.[0]?.content?.parts || [];
    const out = parts.filter(p => !p.thought && p.text).map(p => p.text).join('');
    let result;
    try { result = JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
    catch { return json({ ok: false, error: 'AI 답을 해석하지 못했어요. 다시 찍어 주세요' }, 502); }
    return json({ ok: true, model, result });
  },
};
