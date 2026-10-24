// 영→한 번역: DeepL API Free 우선, 키가 없거나 실패하면 MyMemory(무키) 폴백

const DEEPL_URL = process.env.DEEPL_API_URL || 'https://api-free.deepl.com/v2/translate';

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

/** 여러 문장을 한국어로 번역. 실패한 항목은 빈 문자열 */
export async function translateMany(texts) {
  const items = texts.map((t) => (t || '').trim());
  if (!items.length) return [];
  const key = process.env.DEEPL_API_KEY;
  if (key) {
    try {
      const out = [];
      // DeepL은 요청당 최대 50개 텍스트
      for (let i = 0; i < items.length; i += 50) out.push(...(await deeplBatch(items.slice(i, i + 50), key)));
      return out;
    } catch (err) {
      console.warn('[번역] DeepL 실패, MyMemory로 폴백:', err.message);
    }
  }
  const out = [];
  for (const t of items) {
    if (!t) { out.push(''); continue; }
    try { out.push(await myMemory(t)); } catch (err) { console.warn('[번역] 실패:', err.message); out.push(''); }
  }
  return out;
}

export async function translateOne(text) {
  return (await translateMany([text]))[0];
}
