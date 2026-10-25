// 논문 채팅: 선택한 논문의 초록·분석 내용을 컨텍스트로 OpenAI 호환 Chat API에 질의, 텍스트 스트리밍 응답
// 기본값은 Google Gemini 무료 API(OpenAI 호환 엔드포인트). CHAT_API_URL/CHAT_API_KEY/CHAT_MODEL로 다른 API로 교체 가능

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkAccess } from '../lib/auth.mjs';

const CHAT_URL = process.env.CHAT_API_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const CHAT_KEY = process.env.CHAT_API_KEY || process.env.GEMINI_API_KEY;
// flash-lite가 무료 티어에서 가장 빠르고 안정적(약 6초). 혼잡(503) 시 대체 모델로 전환
const CHAT_MODEL = process.env.CHAT_MODEL || 'gemini-flash-lite-latest';
const FALLBACK_MODEL = process.env.CHAT_FALLBACK_MODEL || 'gemini-2.5-flash';
let papersCache = null;

async function findPaper(id) {
  if (!papersCache) papersCache = JSON.parse(await readFile(join(process.cwd(), 'public/data/papers.json'), 'utf8')).papers;
  return papersCache.find((p) => p.id === id);
}

function systemPrompt(p) {
  const list = (items) => items.map((s) => `- ${s.en}`).join('\n') || '- (없음)';
  return `당신은 AI·로봇 연구 논문을 설명하는 친절한 연구 조교입니다. 아래 논문 정보만 근거로 한국어로 간결하게 답하세요.
논문에 없는 내용은 추측이라고 밝히고, 전문 용어는 영어 원어를 괄호로 병기하세요.

[제목] ${p.title}
[저자] ${p.authors.slice(0, 8).join(', ')}
[게시일] ${p.publishedAt?.slice(0, 10)}
[주제] ${p.categories.join(', ')} / 키워드: ${p.keywords.join(', ')}
[초록]
${p.abstract.en}
[방법론 문장]
${list(p.sections.methodology)}
[연구결과 문장]
${list(p.sections.results)}
[인용횟수] ${p.citations?.count ?? '알 수 없음'}`;
}

function sendError(res, status, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: message }));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendError(res, 405, 'POST만 지원합니다.');
  if (!checkAccess(req, res)) return;
  if (!CHAT_KEY) return sendError(res, 500, 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');

  const { paperId, messages } = req.body || {};
  const paper = await findPaper(paperId).catch(() => null);
  if (!paper) return sendError(res, 404, '논문을 찾을 수 없습니다.');
  // 최근 대화 10개만, 메시지 길이 제한
  const history = (Array.isArray(messages) ? messages : [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!history.length) return sendError(res, 400, '메시지가 비어 있습니다.');

  const request = (model) => fetch(CHAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CHAT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt(paper) }, ...history],
      max_tokens: 2048,
      temperature: 0.4,
      stream: true,
      // Gemini는 내부 추론(thinking) 토큰도 max_tokens에 포함되므로 추론량을 낮춰 답변이 끊기지 않게 함
      ...(CHAT_URL.includes('generativelanguage.googleapis.com') && { reasoning_effort: 'low' }),
    }),
  });
  // 무료 티어는 혼잡 시 503을 자주 반환하므로 대체 모델 → 기본 모델 순으로 재시도
  let upstream = await request(CHAT_MODEL);
  for (const [i, model] of [FALLBACK_MODEL, CHAT_MODEL].entries()) {
    if (upstream.status !== 503) break;
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    upstream = await request(model);
  }
  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.text()).slice(0, 300);
    const hint = upstream.status === 429 ? ' — Gemini 무료 사용 한도를 초과했습니다. 잠시 후 다시 시도하세요.'
      : upstream.status === 503 ? ' — Gemini 서버가 혼잡합니다. 잠시 후 다시 시도하세요.' : '';
    return sendError(res, 502, `채팅 API 오류 (${upstream.status})${hint}: ${detail}`);
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');

  // SSE(data: {...}) 를 받아 텍스트 조각만 클라이언트로 전달
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of upstream.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const data = line.trim().replace(/^data:\s*/, '');
      if (!data || data === '[DONE]' || !line.startsWith('data:')) continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) res.write(delta);
      } catch { /* 불완전한 줄 무시 */ }
    }
  }
  res.end();
}
