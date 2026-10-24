// 영→한 번역: Gemini 우선 → DeepL(키가 있을 때) → MyMemory(무키) 순으로 폴백

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_MODELS = [process.env.CHAT_MODEL || 'gemini-flash-lite-latest', process.env.CHAT_FALLBACK_MODEL || 'gemini-2.5-flash'];
const DEEPL_URL = process.env.DEEPL_API_URL || 'https://api-free.deepl.com/v2/translate';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMPT = `당신은 AI·로봇 분야 학술 번역가입니다. 입력은 영어 문자열의 JSON 배열입니다.
각 항목을 자연스러운 한국어로 번역해 같은 길이·같은 순서의 JSON 문자열 배열만 출력하세요.
- 한 단어 항목은 학술 맥락에서의 한국어 뜻을 짧게 (예: "autonomous" → "자율적인")
- 전문 용어는 처음 나올 때 한국어(영어) 형태로 병기 가능
- 설명·코드블록 없이 JSON 배열만 출력`;

async function geminiBatch(texts, key) {
  let lastError;
  // 기본 모델 → 대체 모델 순으로 시도 (무료 티어 혼잡 503 대비)
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 8192,
          reasoning_effort: 'low',
          messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: JSON.stringify(texts) }],
        }),
      });
      if (res.ok) {
        const content = (await res.json()).choices?.[0]?.message?.content || '';
        const json = content.slice(content.indexOf('['), content.lastIndexOf(']') + 1);
        const out = JSON.parse(json);
        if (!Array.isArray(out) || out.length !== texts.length) throw new Error(`Gemini 번역 개수 불일치 (${out.length}/${texts.length})`);
        return out.map((t) => String(t ?? '').trim());
      }
      lastError = new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
      if (res.status !== 503 && res.status !== 429) break; // 혼잡·한도 외 오류는 다음 모델로
      await sleep(2000 * (attempt + 1));
    }
  }
  throw lastError;
}

async function deeplBatch(texts, key) {
  const res = await fetch(DEEPL_URL, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texts, source_lang: 'EN', target_lang: 'KO' }),
  });
  if (!res.ok) throw new Error(`DeepL ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.translations.map((t) => t.text);
}

async function myMemory(text) {
  const url = `https://api.mymemory.translated.net/get?langpair=en|ko&q=${encodeURIComponent(text.slice(0, 500))}`
    + (process.env.MYMEMORY_EMAIL ? `&de=${encodeURIComponent(process.env.MYMEMORY_EMAIL)}` : '');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MyMemory ${res.status}`);
  const data = await res.json();
  if (data.responseStatus !== 200) throw new Error(`MyMemory: ${data.responseDetails}`);
  return data.responseData.translatedText;
}

// 배치 번역기를 chunk 단위로 실행
async function inChunks(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await fn(items.slice(i, i + size))));
  return out;
}

/** 여러 문장을 한국어로 번역. { texts: 번역 배열(실패 항목은 ''), engine: 사용한 번역기 } */
export async function translateMany(texts) {
  const items = texts.map((t) => (t || '').trim());
  if (!items.length) return { texts: [], engine: null };

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      return { texts: await inChunks(items, 40, (chunk) => geminiBatch(chunk, geminiKey)), engine: 'gemini' };
    } catch (err) {
      console.warn('[번역] Gemini 실패, 다음 번역기로 폴백:', err.message);
    }
  }
  const deeplKey = process.env.DEEPL_API_KEY;
  if (deeplKey) {
    try {
      // DeepL은 요청당 최대 50개 텍스트
      return { texts: await inChunks(items, 50, (chunk) => deeplBatch(chunk, deeplKey)), engine: 'deepl' };
    } catch (err) {
      console.warn('[번역] DeepL 실패, MyMemory로 폴백:', err.message);
    }
  }
  const out = [];
  for (const t of items) {
    if (!t) { out.push(''); continue; }
    try { out.push(await myMemory(t)); } catch (err) { console.warn('[번역] 실패:', err.message); out.push(''); }
  }
  return { texts: out, engine: 'mymemory' };
}

export async function translateOne(text) {
  return (await translateMany([text])).texts[0];
}
