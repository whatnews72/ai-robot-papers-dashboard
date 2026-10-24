// 초록 분석: 문장 분리, 섹션(배경/방법론/결과) 분류, 주제 태그, 영단어 추출

// 방법론 문장 판별 키워드
const METHOD_RE = /\b(we (propose|present|introduce|develop|design|build|construct|train|leverage|use|employ|formulate)|our (approach|method|framework|system|pipeline|model)|framework|architecture|pipeline|algorithm|approach|methodolog|leverag|consists of|comprises|integrat|is trained|fine-tun|benchmark (that|which|to))/i;

// 결과 문장 판별 키워드
const RESULT_RE = /\b(results? (show|demonstrate|indicate|suggest|reveal)|experiments? (show|demonstrate|reveal)|we (show|demonstrate|find|observe|achieve)|demonstrat|achiev|outperform|surpass|improv|state-of-the-art|sota|accuracy|success rate|reduc|speed ?up|faster|find that|shows? that|enabl(es|ing) .* to)|\d+(\.\d+)?\s?%|\d+(\.\d+)?x\b/i;

// 주제 카테고리 규칙
const CATEGORY_RULES = [
  ['AI 과학자', /\b(ai scientist|scientist agent|autonomous (generalist )?scientist|scientific discovery|automated research|research agent|deep research)\b/i],
  ['자율 실험실', /\b(self-driving lab|autonomous lab|laboratory automation|lab automation|automated experiment|autonomous experiment|closed-loop|high-throughput)\b/i],
  ['로봇 조작', /\b(robot(ic)? (arm|manipulation)|manipulat|grasp|embodied|humanoid|vision-language-action|vla)\b/i],
  ['가설·문헌 생성', /\b(hypothes|literature review|idea generation|research idea|paper writing|manuscript|novelty)\b/i],
  ['화학·소재', /\b(chemi|material|molecul|synthesis|catalys|protein|drug)\b/i],
  ['멀티 에이전트', /\b(multi-agent|multiple agents|agent collaboration|agents? (collaborat|coordinat))\b/i],
  ['LLM 에이전트', /\b(llm|large language model|language agent|agentic)\b/i],
  ['벤치마크·평가', /\b(benchmark|evaluation suite|leaderboard)\b/i],
];

// 영단어 추출 시 제외할 흔한 단어
const STOP = new Set(`about above across after again against along already also although among another anyone anything around because become becomes been before being below between beyond both cannot could current currently different does doing during each either enough especially every existing first following further given having however including instead itself large later latest least little made make makes making many might more most much must needs never often other others otherwise over paper papers perform performance present proposed provide provides rather really recent recently same several should show shows significant significantly since some still such than that their them themselves then there therefore these they thing things this those though three through thus together toward towards under until upon using various very well were what when where whether which while within without would years model models method methods approach approaches system systems based results result data task tasks work works study studies research researchers human humans which allowing across beyond important several`.split(/\s+/));

/** 초록 텍스트를 문장 배열로 분리 */
export function splitSentences(text) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  // 약어(e.g., i.e., et al.)와 소수점은 분리하지 않음
  const protectedText = clean
    .replace(/\b(e\.g|i\.e|et al|etc|vs|Fig|Eq)\./gi, (m) => m.replace(/\./g, '§'))
    .replace(/(\d)\.(\d)/g, '$1§$2');
  return protectedText
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"(\[])/)
    .map((s) => s.replace(/§/g, '.').trim())
    .filter((s) => s.length > 3);
}

/** 문장을 background / methodology / results 로 분류 */
export function classifySentences(sentences) {
  const sections = { background: [], methodology: [], results: [] };
  sentences.forEach((s, i) => {
    const isResult = RESULT_RE.test(s);
    const isMethod = METHOD_RE.test(s);
    // 초록 후반부의 결과 키워드 문장은 결과 우선, 전반부는 방법론 우선
    if (isResult && (!isMethod || i >= sentences.length / 2)) sections.results.push(s);
    else if (isMethod) sections.methodology.push(s);
    else if (isResult) sections.results.push(s);
    else sections.background.push(s);
  });
  // 비어 있는 섹션은 위치 기반으로 보완 (초록은 대개 배경→방법→결과 순서)
  if (!sections.methodology.length && sentences.length > 2) {
    sections.methodology.push(sentences[Math.floor(sentences.length / 2)]);
  }
  if (!sections.results.length && sentences.length > 1) {
    sections.results.push(sentences[sentences.length - 1]);
  }
  return sections;
}

/** 제목·초록·키워드로 주제 카테고리 태그 생성 */
export function categorize(paper) {
  const text = `${paper.title} ${paper.summary} ${(paper.ai_keywords || []).join(' ')}`;
  const tags = CATEGORY_RULES.filter(([, re]) => re.test(text)).map(([name]) => name);
  return tags.length ? tags : ['기타'];
}

/** 초록에서 학습할 학술 영단어와 예문 추출 */
export function extractVocab(sentences, keywords = [], max = 10) {
  const keywordWords = new Set(
    keywords.flatMap((k) => k.toLowerCase().split(/[\s-]+/)).filter((w) => w.length >= 5)
  );
  const freq = new Map();
  const firstSentence = new Map();
  sentences.forEach((s) => {
    for (const raw of s.match(/[A-Za-z][a-z]+(?:-[a-z]+)?/g) || []) {
      const w = raw.toLowerCase();
      if (w.length < 6 || STOP.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
      if (!firstSentence.has(w)) firstSentence.set(w, s);
    }
  });
  const scored = [...freq.entries()].map(([w, f]) => {
    // 길고, 키워드에 포함되며, 적당히 반복되는 단어에 가중치
    let score = Math.min(w.length, 13) / 2 + f;
    if (keywordWords.has(w)) score += 3;
    if (/(tion|ment|ity|ance|ence|ology|ize|ise|ous|ive|ical)$/.test(w)) score += 1.5;
    return { word: w, score, sentence: firstSentence.get(w) };
  });
  // 같은 어간(앞 6글자) 중복 제거
  const seen = new Set();
  return scored
    .sort((a, b) => b.score - a.score)
    .filter(({ word }) => {
      const stem = word.slice(0, 6);
      if (seen.has(stem)) return false;
      seen.add(stem);
      return true;
    })
    .slice(0, max)
    .map(({ word, sentence }) => ({ word, sentence }));
}
