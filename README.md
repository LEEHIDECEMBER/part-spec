# 부품 사양 찾기 (part-spec)

저항·콘덴서·인덕터·모터 명판·차단기·전선의 사진을 찍거나 표기를 입력하면 사양을 알려 주는 PWA.

- 화면: `index.html` (순수 HTML/CSS/JS) + 계산: `calc.js`
- 사진 분석: 앱 → Cloudflare Worker(`worker/worker.js`) → Google Gemini → 읽은 값(JSON) → 앱의 `calc.js`가 계산
- 기록: 이 기기 localStorage (`ep.` 접두어), JSON 백업

## 1. GitHub Pages 배포
1. GitHub에서 새 저장소 `part-spec` (Public) 만들기
2. 이 폴더의 파일을 그대로 올리기 (`index.html`이 맨 위에 있어야 함). `worker/` 폴더는 올려도 되고 안 올려도 됨 (비밀값 없음)
3. Settings → Pages → Branch `main` / `(root)` → Save
4. 주소: `https://leehidecember.github.io/part-spec/`

여기까지 하면 **직접 입력 계산과 "예시로 체험"은 바로 동작**한다.

## 2. AI 사진 분석 연결 (Cloudflare Worker, 무료)
1. https://aistudio.google.com 에서 **API 키 만들기** (결제 정보는 연결하지 않기 → 무료 한도를 넘어도 요금이 나가지 않고 429 오류만 남)
2. https://dash.cloudflare.com 가입 → Workers & Pages → Create → Worker 만들기 (이름 예: `part-spec-ai`)
3. Edit code → `worker/worker.js` 내용을 전부 붙여넣고 Deploy
4. Worker → Settings → Variables and Secrets
   - Secret `GEMINI_API_KEY` = 1번에서 받은 키
   - (선택) Text `ALLOWED_ORIGINS` = `https://leehidecember.github.io`
   - (선택) Text `MODEL` = `gemini-flash-latest`
5. Worker 주소(`https://part-spec-ai.○○○.workers.dev`)를 브라우저로 열어 `{"ok":true,...,"keySet":true}`가 나오는지 확인
6. 앱 설정 → AI 사진 분석 서버에 주소 넣고 저장 → 연결 확인
   (모든 기기에 기본으로 넣으려면 `index.html`의 `DEFAULT_AI_URL`에 주소를 적고 다시 올리기)

## 앱 수정 후 배포할 때
`sw.js`의 `CACHE = 'part-spec-v1'` 숫자를 올린다.
