# AI·로봇 연구 논문 대시보드

[Hugging Face Papers](https://huggingface.co/papers)에서 **AI와 로봇을 활용한 연구 과정**(AI 과학자, 자율 실험실, 로봇 과학자 등) 관련 최신 논문을 매일 오전 9시(KST)에 자동으로 수집해 보여주는 대시보드입니다.

## 기능
| 섹션 | 내용 |
|---|---|
| 주제 | 규칙 기반 카테고리 태그, HF AI 요약(영/한), 키워드, 배경 문장 |
| 방법론 / 연구결과 | 초록 문장을 키워드로 분류하고 문장별 한국어 번역 + 🔊 TTS |
| 영단어 · 예문 | 초록에서 추출한 학술 어휘 10개, 뜻, 원문 예문, 단어·예문 발음 듣기 |
| 초록 | 원문 + 한국어 번역, 전체 듣기 |
| 연결 링크 | Hugging Face / arXiv / PDF / GitHub |
| 인용횟수 | Semantic Scholar (실패 시 OpenAlex) |
| 채팅 | 선택한 논문을 컨텍스트로 Google Gemini 무료 API에 질문 (한국어 답변, 스트리밍) |
| 앱 설치 | PWA — 안드로이드 Chrome에서 앱으로 설치, 오프라인에서도 마지막 수집 논문 열람 |

- TTS는 브라우저 내장 Web Speech API를 사용하므로 별도 키가 필요 없습니다 (Chrome/Edge 권장).
- 번역은 Gemini 무료 API(채팅과 같은 키)를 사용하고, 실패하면 DeepL(키가 있을 때) → MyMemory 무료 API 순으로 대체합니다.

## 구조
```
scripts/collect.mjs   논문 검색·분석·번역·인용수 → public/data/papers.json
scripts/dev.mjs       로컬 개발 서버
lib/analyze.mjs       문장 분리, 섹션 분류, 주제 태그, 영단어 추출
lib/translate.mjs     Gemini / DeepL / MyMemory 번역
lib/auth.mjs          API 개인 접근 코드 검사 (APP_PASSCODE)
scripts/make-icons.mjs  앱 아이콘 PNG 생성 (npm run icons)
api/chat.js           논문 채팅 - Gemini (Vercel 서버리스 함수)
api/translate.js      번역 프록시 (Vercel 서버리스 함수)
public/               대시보드 화면 (HTML/CSS/JS, 의존성 없음)
public/manifest.webmanifest, public/sw.js   PWA 매니페스트·서비스 워커
.github/workflows/collect.yml   매일 09:00 KST 자동 수집
```

## 로컬 실행
```bash
cp .env.example .env      # 키 입력
npm run collect           # 논문 수집 (최초 1회)
npm run dev               # http://localhost:3000
```
Node.js 20.6 이상이 필요합니다. 외부 패키지는 사용하지 않습니다.

## 배포 (GitHub + Vercel)
1. **GitHub 저장소 생성 후 푸시**
   ```bash
   git init && git add . && git commit -m "최초 커밋"
   git branch -M main
   git remote add origin https://github.com/<계정>/<저장소>.git
   git push -u origin main
   ```
2. **GitHub Secrets 등록** — 저장소 Settings → Secrets and variables → Actions
   - `GEMINI_API_KEY` (번역용, 필수), `DEEPL_API_KEY`·`S2_API_KEY`·`MYMEMORY_EMAIL` (선택)
3. **Vercel 연결** — [vercel.com/new](https://vercel.com/new)에서 저장소 Import
   - Framework Preset: `Other`, Build Command 비움 (`vercel.json`이 `public/`을 출력 폴더로 지정)
   - Environment Variables: `GEMINI_API_KEY` (채팅·번역 공용, 선택 `CHAT_MODEL`), `APP_PASSCODE` (나만 쓰는 접근 코드, 권장)
4. **첫 수집 실행** — GitHub Actions 탭 → "논문 자동 수집" → Run workflow
   - 이후 매일 09:00(KST)에 자동 실행되고, `papers.json`이 바뀌면 커밋되어 Vercel이 자동 재배포합니다.

## 📱 안드로이드에 앱으로 설치
플레이스토어 없이 PWA로 설치합니다. 배포가 갱신되면 앱도 자동으로 최신 상태가 됩니다.
1. Vercel 환경변수에 `APP_PASSCODE`(본인만 아는 문자열)를 추가하고 재배포합니다. 설정하면 다른 사람이 주소를 알아도 채팅·번역 API(Gemini 한도)를 쓸 수 없습니다.
2. 폰의 **Chrome**에서 배포 주소에 접속합니다.
3. 오른쪽 위 ⋮ 메뉴 → **앱 설치**(또는 "홈 화면에 추가" → 설치)를 누르면 앱 서랍에 🤖 아이콘이 생깁니다.
4. 앱에서 처음 채팅하거나 번역할 때 접근 코드를 한 번 입력하면 기기에 저장됩니다.

- 오프라인에서도 마지막으로 받은 논문 목록·상세를 볼 수 있습니다 (채팅·번역은 인터넷 필요).
- 아이콘을 바꾸려면 `scripts/make-icons.mjs`를 수정한 뒤 `npm run icons`를 실행하세요.
- 앱 셸을 크게 바꿨는데 반영이 늦으면 `public/sw.js`의 `CACHE` 버전을 올리세요.

> ⚠ `.env`는 `.gitignore`에 포함되어 있습니다. 토큰을 저장소에 커밋하지 마세요.
> GitHub 예약 실행은 부하에 따라 수 분~수십 분 지연될 수 있고, 저장소에 60일간 활동이 없으면 자동 중지됩니다.

## 설정
- 검색어: `scripts/collect.mjs`의 `QUERIES`
- 수집 편수: 환경변수 `MAX_PAPERS` (기본 5)
- 섹션 분류 키워드·주제 카테고리: `lib/analyze.mjs`
