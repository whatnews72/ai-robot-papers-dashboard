// 임의 영어 텍스트 → 한국어 번역 (DeepL 키는 서버에만 보관)

import { translateOne } from '../lib/translate.mjs';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const text = req.method === 'POST' ? req.body?.text : null;
  if (typeof text !== 'string' || !text.trim()) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'text가 필요합니다.' }));
  }
  try {
    const ko = await translateOne(text.slice(0, 3000));
    if (!ko) throw new Error('번역 API 응답 없음 (DeepL 키 또는 무료 한도 확인)');
    res.end(JSON.stringify({ ko }));
  } catch (err) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: err.message }));
  }
}
