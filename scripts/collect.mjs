// Hugging Face Papers에서 "AI·로봇 기반 연구 자동화" 최신 논문을 수집·분석해 public/data/papers.json 생성
// 실행: node --env-file=.env scripts/collect.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSentences, classifySentences, categorize, extractVocab } from '../lib/analyze.mjs';
import { translateMany } from '../lib/translate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/data/papers.json');
const MAX_PAPERS = Number(process.env.MAX_PAPERS || 5);

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
  return [...byId.values()]
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, MAX_PAPERS);
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
  const translated = await translateMany([...sentences, aiSummary, ...words]);
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
  };
}

async function main() {
  let previous = { papers: [] };
  try { previous = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* 첫 실행 */ }
  const prevById = new Map(previous.papers.map((p) => [p.id, p]));

  const found = await searchPapers();
  console.log(`[수집] 대상 ${found.length}편 (신규 ${found.filter((p) => !prevById.has(p.id)).length}편)`);

  const papers = [];
  for (const p of found) {
    const prev = prevById.get(p.id);
    // 이미 번역된 논문은 재번역하지 않고 업보트 등 메타만 갱신 (번역 한도 절약)
    if (prev && prev.abstract?.ko) {
      papers.push({ ...prev, upvotes: p.upvotes ?? prev.upvotes, githubStars: p.githubStars ?? prev.githubStars });
      continue;
    }
    console.log(`[분석] ${p.id} ${p.title.slice(0, 60)}`);
    papers.push(await analyzePaper(p));
  }

  const citations = await fetchCitations(papers.map((p) => p.id));
  for (const p of papers) {
    const c = citations[p.id];
    // 이번 조회가 실패하면 이전 값 유지
    if (c?.count != null) p.citations = c;
    else p.citations = p.citations || { count: null, source: null };
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), queries: QUERIES, papers }, null, 2));
  console.log(`[완료] ${papers.length}편 저장 → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
