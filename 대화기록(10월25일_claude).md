# 대화 기록 — 2026년 10월 25일 (Claude Code)

프로젝트: AI·로봇 연구 논문 대시보드 (`D:\AI_Agent만들기\논문`)
배포 주소: https://ai-robot-papers-dashboard.vercel.app
저장소: https://github.com/whatnews72/ai-robot-papers-dashboard

---

## 1. 논문 내용 숙지

**요청:** 논문 안에 있는 내용들을 숙지해.

**진행:** `public/data/papers.json`(2026-10-24 22:28 UTC 갱신)에 수집된 논문 5편의 초록·메타데이터를 읽고 정리했다. 데이터에는 초록·AI 요약·키워드·어휘만 있고 본문은 없다.

| # | 논문 | 핵심 내용 |
|---|---|---|
| 1 | Building AI Research Teams for Autonomous Discovery of Linear Attention Architectures (2610.28887, 추천 36) | 전공 배경이 다른 AI 연구자 에이전트 팀 구성. 핵심 요소는 학문 배경, 개인 연구 기록, 적응형 실험 할당. 찾아낸 선형 어텐션 구조가 1.3B 규모에서 GDN2를 능가. 요소를 하나씩 빼면 성과가 뚜렷이 나빠짐 |
| 2 | Sage-A1.5 (2610.28578, 추천 72) | A1 기반 35B MoE 에이전트 모델. 오케스트레이션(서브에이전트 병렬 위임), 검증(진행 점검·전략 수정), 개방형 과학 탐구 강화 |
| 3 | AI-Driven Reproducibility and Analytical Robustness in Scientific Discovery (2610.23845) | SEER 암 등록 DB 기반 SEER-Repro 벤치마크(논문 20편). 에이전트가 원자적 주장 2,190개 중 77.4% 재현. 완전히 재현된 결과의 9.5%에서 결론을 바꿀 수 있는 분석 선택을 찾아 전문가 검토 대상으로 표시 |
| 4 | Towards Agentic Robots: Model, Data, Environment, and Harness (2610.20442, 추천 43, 서베이) | VLA → 세계 모델 → 세계-행동 모델로의 발전 정리. 연구를 4개 기능 영역(Model·Data·Environment·Harness), 17개 범주로 분류 |
| 5 | The Agentic Scientist (2610.18933, Sakana AI) | 연구를 8단계로 나눈 분산 파이프라인. 메타 컨트롤러가 병렬 에이전트를 관리하고 단계마다 루브릭 검증. 공동 연구자 모드로 쓴 논문이 ALIFE 2026에 채택 |

**공통 흐름:** 자율 연구의 성능은 기반 모델만이 아니라 조직 구조(오케스트레이션·기억·자원 배분)와 검증 계층이 좌우한다(1·2·5번). AI의 역할도 연구 생산에서 재현·검증으로 넓어지고 있다(3번).

**참고:** 5편 모두 인용수 0(게시 2주 이내). 1번은 HF AI 요약·키워드가 비어 있음.

---

## 2. 웹페이지를 안드로이드 개인용 앱으로 만들기

**요청:** 배포한 웹페이지를 핸드폰에서 사용할 수 있는 앱으로 만드는 계획을 세워줘. 플레이스토어에 올릴 필요는 없고 나만 사용할 수 있는 앱이야.

**확인한 선택 사항**
- 기종: **안드로이드**
- 접근 제한: **API만 비밀번호** (화면·데이터는 공개, 채팅·번역 API에만 개인 접근 코드)

**방식:** PWA(Progressive Web App). Chrome에서 "앱 설치"로 설치하면 앱 서랍에 아이콘이 생기고 주소창 없이 실행된다. 스토어·빌드·서명이 필요 없고, 기존 GitHub Actions → Vercel 자동 배포가 그대로 앱 업데이트가 된다.

### 구현 내용

| 파일 | 변경 |
|---|---|
| `public/manifest.webmanifest` (신규) | 앱 이름 "AI·로봇 연구 논문", 짧은 이름 "논문", standalone 실행, 아이콘 3종 |
| `scripts/make-icons.mjs` (신규) | 외부 패키지 없이 `node:zlib`으로 파란 배경 + 흰 로봇 머리 PNG 생성 (`npm run icons`) |
| `public/icons/*.png` (신규) | icon-192, icon-512, icon-maskable-512 |
| `public/sw.js` (신규) | 서비스 워커. 화면·데이터는 네트워크 우선 → 실패 시 캐시(오프라인 열람). 폰트는 캐시 우선. `/api/*`는 가로채지 않음 |
| `lib/auth.mjs` (신규) | `APP_PASSCODE` 환경변수와 `X-App-Passcode` 헤더를 해시 후 `timingSafeEqual`로 비교. 불일치 시 401. 환경변수가 비면 검사 생략(로컬 개발용) |
| `api/chat.js`, `api/translate.js` | 핸들러 시작 부분에서 `checkAccess` 호출 |
| `public/app.js` | `apiFetch` 헬퍼(코드 헤더 자동 첨부), 401이면 채팅창에 접근 코드 입력 폼 → 저장 후 요청 자동 재시도, 서비스 워커 등록 |
| `public/index.html` | 매니페스트·아이콘·theme-color 메타 태그, `viewport-fit=cover`, 접근 코드 입력 폼 |
| `public/styles.css` | 입력 폼 스타일, 노치·제스처 바 여백(safe-area), 설치 앱에서 당겨서 튕김 방지 |
| `scripts/dev.mjs` | `.png`, `.webmanifest` MIME 타입 추가 |
| `.gitignore` | `!public/icons/*.png` 예외 추가 (`*.png` 전체 제외 규칙 때문) |
| `package.json`, `.env.example`, `README.md` | `icons` 스크립트, `APP_PASSCODE` 설명, 안드로이드 설치 안내 |

### 로컬 검증 (`APP_PASSCODE=test`)
- 매니페스트·서비스 워커·아이콘·데이터 모두 200, 서비스 워커 activated, 앱 화면 파일 9개 캐시
- 코드 없이 요청 / 틀린 코드 → 401, 맞는 코드 → 번역·채팅 스트리밍 정상
- 브라우저에서 질문 → 입력 폼 표시 → 틀린 코드에 "맞지 않습니다" 안내 → 맞는 코드 입력 시 같은 질문의 답변 수신

---

## 3. 커밋·푸시

- 커밋 `7b99619` — "기능: 안드로이드 앱 설치(PWA)와 API 접근 코드 추가"
- 원격에 자동 수집 커밋이 하나 있어 그 위에 rebase한 뒤 `main`에 푸시
- 개인 메모 파일 `AI 로봇 연구 논문 배포주소.txt`는 커밋에서 제외

---

## 4. Vercel 환경변수 설정과 재배포

1. 처음에는 **팀 설정** 화면을 열어 환경변수 메뉴가 보이지 않았다. **프로젝트(ai-robot-papers-dashboard) → Settings → Environment Variables**로 이동하도록 안내했다.
2. **Add Environment Variable**에서 `APP_PASSCODE`를 추가했다(Production·Preview).
3. **Deployments → ⋯ → Redeploy** (Production, Build Cache 끔).
4. 재배포 Ready 확인 후 실제 배포 주소를 점검했다.
   - 메인 화면·매니페스트·서비스 워커·아이콘: 모두 200
   - 번역 API 코드 없이 요청: **401 차단**
   - 채팅 API 틀린 코드로 요청: **401 차단**

**참고:** Deploy Logs의 경고 3개와 Deployment Settings의 "2 Recommendations"는 배포·사용에 영향이 없다.

---

## 5. 폰에 앱 설치

**설치 방법 (안드로이드 Chrome)**
1. 배포 주소 접속
2. 주소창 오른쪽 **⋮** → **앱 설치** (또는 "홈 화면에 추가" → 설치)
3. 앱 서랍에 파란 로봇 아이콘 생성

**접근 코드:** 앱을 처음 켤 때가 아니라 **채팅·번역을 처음 쓸 때** 입력 칸이 뜨도록 설계했다. 논문 목록·상세·발음 듣기는 코드 없이 사용할 수 있다.

**결과:** 폰 앱에서 코드를 입력하고 질문에 대한 답변을 정상적으로 받았다. ✅

---

## 알아둘 점
- Chrome 사이트 데이터를 지우거나 앱을 다시 설치하면 접근 코드를 한 번 더 입력해야 한다.
- 코드를 바꾸려면 Vercel의 `APP_PASSCODE`를 수정하고 **Redeploy**한다. 앱이 새 코드를 한 번 묻는다.
- 오프라인에서는 마지막으로 받은 논문만 볼 수 있다. 채팅·번역은 인터넷이 필요하다.
- 아이콘을 바꾸려면 `scripts/make-icons.mjs`를 수정한 뒤 `npm run icons`를 실행한다.
- 앱 화면 파일을 크게 바꿨는데 반영이 늦으면 `public/sw.js`의 `CACHE` 버전을 올린다.
- 매일 오전 9시(KST) 수집 → GitHub 커밋 → Vercel 재배포로 앱에도 새 논문이 자동 반영된다.
