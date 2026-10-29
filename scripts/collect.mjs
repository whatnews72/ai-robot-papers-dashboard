// Hugging Face Papers에서 "AI·로봇 기반 연구 자동화" 최신 논문을 수집·분석해 public/data/papers.json 생성
// 실행: node --env-file=.env scripts/collect.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSentences, classifySentences, categorize, extractVocab } from '../lib/analyze.mjs';
import { translateMany } from '../lib/translate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/data/papers.json');
// 한 번 실행에 새로 추가할 최대 편수 (번역 한도 절약)
const MAX_PAPERS = Number(process.env.MAX_PAPERS || 10);
// 검색 결과 중 게시일이 최근 N일 이내인 논문만 새로 추가 (색인이 늦게 된 논문도 이 기간 안이면 잡힘)
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 14);
// 누적 보관: 수집일 기준 N일이 지나거나 N편을 넘으면 오래된 것부터 정리
const KEEP_DAYS = Number(process.env.KEEP_DAYS || 90);
const MAX_STORED = Number(process.env.MAX_STORED || 300);
const DAY = 24 * 60 * 60 * 1000;

const QUERIES = [
  'AI scientist autonomous research',
  'robot scientist',
  'self-driving laboratory',
  'autonomous experimentation robot',
  'agentic AI scientific discovery',
  'embodied AI laboratory automation',
  'LLM agent research automation',
  'automated scientific experiment robotics',
];

// 주제 적합성 필터: "연구/실험/발견" + "AI/로봇/에이전트" 모두 언급
const SCIENCE_RE = /\b(scien|research|laborator|lab\b|discover|hypothes)/i;
const AGENT_RE = /\b(robot|agent|autonom|\bAI\b|LLM|language model|embodied)/i;

// 일간 논문용 엄격 필터: 연구 자동화 표현이 제목에 있거나 초록에 서로 다른 표현이 2개 이상
// (일간 논문은 검색어 관련도를 거치지 않아 느슨한 필터로는 일반 에이전트 논문이 대거 섞임)
const STRICT_SCIENCE_RE = /\b(scientific (discovery|research|experiments?|exploration|ideas?|closure|hypothes[ie]s)|for science|scientists?\b|laborator(y|ies)|wet[- ]lab|self-driving lab|lab automation|autonomous (research|experiment\w*|discovery)|automated (research|science|scientific|experiment\w*)|research (agents?|automation|teams?)|ai scientists?|experimental design|experiment(s|al)? (design|planning|outcomes?)|physical laws?|hypothes[ie]s (generation|testing|proposal|discovery))/gi;
const STRICT_AGENT_RE = /\b(robots?|agents?|agentic|autonomous|LLMs?|large language models?|language models?|embodied|AI)\b/i;

function isStrictMatch(p) {
  if (!STRICT_AGENT_RE.test(`${p.title} ${p.summary}`)) return false;
  if ((p.title || '').match(STRICT_SCIENCE_RE)) return true;
  const hits = new Set(((p.summary || '').match(STRICT_SCIENCE_RE) || []).map((s) => s.toLowerCase()));
  return hits.size >= 2;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, options = {}, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...options, headers: { 'User-Agent': 'ai-robot-papers-dashboard', ...options.headers } });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    throw new Error(`${res.status} ${url}`);
  }
}

async function searchPapers() {
  const byId = new Map();
  for (const q of QUERIES) {
    try {
      const list = await fetchJson(`https://huggingface.co/api/papers/search?q=${encodeURIComponent(q)}&limit=50`);
      for (const item of list) {
        const p = item.paper;
        if (!p?.id || byId.has(p.id)) continue;
        const text = `${p.title} ${p.summary}`;
        if (!SCIENCE_RE.test(text) || !AGENT_RE.test(text)) continue;
        byId.set(p.id, p);
      }
      console.log(`[검색] "${q}" → 누적 ${byId.size}편`);
    } catch (err) {
      console.warn(`[검색] "${q}" 실패:`, err.message);
    }
  }
  // 검색은 관련도순 상위 50편이라 최신 논문이 밀려나므로, 최근 일간 논문도 함께 확인
  let daily = 0;
  for (let k = 0; k < LOOKBACK_DAYS; k++) {
    const date = new Date(Date.now() - k * DAY).toISOString().slice(0, 10);
    try {
      const list = await fetchJson(`https://huggingface.co/api/daily_papers?date=${date}&limit=100`);
      for (const item of list) {
        const p = item.paper;
        if (!p?.id || byId.has(p.id) || !isStrictMatch(p)) continue;
        byId.set(p.id, p);
        daily++;
      }
    } catch (err) {
      console.warn(`[일간] ${date} 실패:`, err.message);
    }
  }
  console.log(`[일간] 최근 ${LOOKBACK_DAYS}일 일간 논문에서 추가 후보 ${daily}편 → 누적 ${byId.size}편`);
  return [...byId.values()].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

// 인용수: Semantic Scholar 일괄 조회 → 누락분은 OpenAlex 폴백
async function fetchCitations(ids) {
  const result = {};
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.S2_API_KEY) headers['x-api-key'] = process.env.S2_API_KEY;
    const data = await fetchJson(
      'https://api.semanticscholar.org/graph/v1/paper/batch?fields=citationCount',
      { method: 'POST', headers, body: JSON.stringify({ ids: ids.map((id) => `arXiv:${id}`) }) },
      4
    );
    data.forEach((d, i) => {
      if (d && typeof d.citationCount === 'number') result[ids[i]] = { count: d.citationCount, source: 'Semantic Scholar' };
    });
  } catch (err) {
    console.warn('[인용] Semantic Scholar 실패:', err.message);
  }
  for (const id of ids.filter((id) => !result[id])) {
    try {
      const d = await fetchJson(`https://api.openalex.org/works/doi:10.48550/arXiv.${id}`, {}, 1);
      result[id] = { count: d.cited_by_count ?? 0, source: 'OpenAlex' };
    } catch {
      result[id] = { count: null, source: null };
    }
  }
  return result;
}

// 논문 1편 분석 + 번역
async function analyzePaper(p) {
  const sentences = splitSentences(p.summary);
  const sections = classifySentences(sentences);
  const vocab = extractVocab(sentences, p.ai_keywords || []);
  const aiSummary = p.ai_summary || '';

  // 문장·요약·단어를 한 번에 번역 (문장 번역을 섹션/예문에서 재사용)
  const words = vocab.map((v) => v.word);
  const { texts: translated, engine } = await translateMany([...sentences, aiSummary, ...words]);
  const ko = new Map(sentences.map((s, i) => [s, translated[i]]));
  const aiSummaryKo = translated[sentences.length];
  // 번역기가 단어를 그대로 돌려준 경우는 뜻 없음으로 처리
  const wordsKo = translated.slice(sentences.length + 1).map((t, i) => (t.toLowerCase() === words[i] ? '' : t));
  const pair = (s) => ({ en: s, ko: ko.get(s) || '' });

  return {
    id: p.id,
    title: p.title,
    authors: (p.authors || []).filter((a) => !a.hidden).map((a) => a.name),
    publishedAt: p.publishedAt,
    upvotes: p.upvotes ?? 0,
    keywords: (p.ai_keywords || []).slice(0, 10),
    categories: categorize(p),
    aiSummary: { en: aiSummary, ko: aiSummaryKo },
    abstract: { en: sentences.join(' '), ko: sentences.map((s) => ko.get(s)).filter(Boolean).join(' ') },
    sentences: sentences.map(pair),
    sections: {
      background: sections.background.map(pair),
      methodology: sections.methodology.map(pair),
      results: sections.results.map(pair),
    },
    vocab: vocab.map((v, i) => ({ word: v.word, ko: wordsKo[i] || '', sentence: v.sentence, sentenceKo: ko.get(v.sentence) || '' })),
    links: {
      hf: `https://huggingface.co/papers/${p.id}`,
      arxiv: `https://arxiv.org/abs/${p.id}`,
      pdf: `https://arxiv.org/pdf/${p.id}`,
      github: p.githubRepo || null,
    },
    githubStars: p.githubStars ?? null,
    translatedBy: engine,
  };
}

// 이전 번역을 재사용할 수 있는지: Gemini 키가 있으면 Gemini 번역본만 재사용(품질 낮은 번역은 다시 번역)
function canReuse(prev) {
  if (!prev?.abstract?.ko) return false;
  return !process.env.GEMINI_API_KEY || prev.translatedBy === 'gemini';
}

async function main() {
  let previous = { papers: [] };
  try { previous = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* 첫 실행 */ }
  const now = new Date().toISOString();
  // 수집일이 없는 기존 논문은 마지막 수집 시각으로 채움
  const stored = previous.papers.map((p) => ({ ...p, collectedAt: p.collectedAt || previous.updatedAt || now }));
  const storedById = new Map(stored.map((p) => [p.id, p]));

  const found = await searchPapers();
  const since = Date.now() - LOOKBACK_DAYS * DAY;
  const fresh = found.filter((p) => !storedById.has(p.id) && new Date(p.publishedAt).getTime() >= since).slice(0, MAX_PAPERS);
  console.log(`[수집] 검색 ${found.length}편 중 신규 ${fresh.length}편 (최근 ${LOOKBACK_DAYS}일, 최대 ${MAX_PAPERS}편)`);

  // 기존 논문: 검색 결과에 있으면 업보트 등 메타만 갱신, 품질 낮은 번역은 다시 번역
  const foundById = new Map(found.map((p) => [p.id, p]));
  const papers = [];
  for (const prev of stored) {
    const p = foundById.get(prev.id);
    if (p && !canReuse(prev)) {
      console.log(`[재번역] ${p.id} ${p.title.slice(0, 60)}`);
      papers.push({ ...(await analyzePaper(p)), collectedAt: prev.collectedAt, citations: prev.citations });
      continue;
    }
    papers.push(p ? { ...prev, upvotes: p.upvotes ?? prev.upvotes, githubStars: p.githubStars ?? prev.githubStars } : prev);
  }
  for (const p of fresh) {
    console.log(`[분석] ${p.id} ${p.title.slice(0, 60)}`);
    papers.push({ ...(await analyzePaper(p)), collectedAt: now });
  }

  // 보관 기간·편수 초과분 정리 (수집일 최신순 → 게시일 최신순)
  const keepSince = Date.now() - KEEP_DAYS * DAY;
  const kept = papers
    .filter((p) => new Date(p.collectedAt).getTime() >= keepSince)
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt) || new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, MAX_STORED);
  if (kept.length < papers.length) console.log(`[정리] 오래된 논문 ${papers.length - kept.length}편 제외`);

  const citations = await fetchCitations(kept.map((p) => p.id));
  for (const p of kept) {
    const c = citations[p.id];
    // 이번 조회가 실패하면 이전 값 유지
    if (c?.count != null) p.citations = c;
    else p.citations = p.citations || { count: null, source: null };
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ updatedAt: now, queries: QUERIES, papers: kept }, null, 2));
  console.log(`[완료] ${kept.length}편 저장 (신규 ${fresh.length}편) → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
