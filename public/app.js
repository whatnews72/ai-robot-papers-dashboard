// AI·로봇 연구 논문 대시보드 프런트엔드

const $ = (sel) => document.querySelector(sel);
const state = {
  papers: [],
  selectedId: null,
  category: '전체',
  query: '',
  sort: 'date',
  showKo: true,
  chats: new Map(), // 논문별 대화 기록
  busy: false,
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 채팅 답변용 간단 마크다운(굵게, 제목, 목록, 코드, 구분선) 렌더링
const md = (s) =>
  esc(s)
    .replace(/^#{1,4}\s+(.+)$/gm, '<strong>$1</strong>')
    .replace(/^\s*[*-]\s+/gm, '• ')
    .replace(/^-{3,}$/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n{3,}/g, '\n\n');
const fmtDate =(iso) => (iso ? new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : '-');

/* ---------- TTS (Web Speech API) ---------- */
let voices = [];
const loadVoices = () => { voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en')); };
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}
let speakingBtn = null;

function speak(text, btn) {
  if (!('speechSynthesis' in window)) return alert('이 브라우저는 음성 합성을 지원하지 않습니다.');
  const wasSame = speakingBtn === btn && speechSynthesis.speaking;
  speechSynthesis.cancel();
  speakingBtn?.classList.remove('speaking');
  speakingBtn = null;
  if (wasSame) return; // 같은 버튼 재클릭 시 정지
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = Number($('#rate').value);
  u.voice = voices.find((v) => v.lang === 'en-US' && /Google|Natural|Samantha|Aria|Jenny/.test(v.name)) || voices.find((v) => v.lang === 'en-US') || null;
  u.onend = u.onerror = () => { btn?.classList.remove('speaking'); if (speakingBtn === btn) speakingBtn = null; };
  btn?.classList.add('speaking');
  speakingBtn = btn;
  speechSynthesis.speak(u);
}

const speakBtn = (text, label = '듣기') =>
  `<button class="icon-btn" data-speak="${esc(text)}" title="${label}" aria-label="${label}">🔊</button>`;

/* ---------- 목록 ---------- */
function filtered() {
  const q = state.query.toLowerCase();
  const list = state.papers.filter((p) => {
    if (state.category !== '전체' && !p.categories.includes(state.category)) return false;
    if (!q) return true;
    return `${p.title} ${p.keywords.join(' ')} ${p.categories.join(' ')} ${p.abstract.en}`.toLowerCase().includes(q);
  });
  const key = {
    date: (p) => new Date(p.publishedAt).getTime(),
    citations: (p) => p.citations?.count ?? -1,
    upvotes: (p) => p.upvotes ?? 0,
  }[state.sort];
  return list.sort((a, b) => key(b) - key(a));
}

function renderChips() {
  const counts = {};
  state.papers.forEach((p) => p.categories.forEach((c) => (counts[c] = (counts[c] || 0) + 1)));
  const cats = ['전체', ...Object.keys(counts).sort((a, b) => counts[b] - counts[a])];
  $('#chips').innerHTML = cats
    .map((c) => `<button class="chip ${c === state.category ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}${c === '전체' ? '' : ` ${counts[c]}`}</button>`)
    .join('');
}

function renderList() {
  const list = filtered();
  $('#count').textContent = `논문 ${list.length}편`;
  $('#paperList').innerHTML = list
    .map(
      (p) => `<li class="card ${p.id === state.selectedId ? 'active' : ''}" data-id="${p.id}" tabindex="0">
        <h3>${esc(p.title)}</h3>
        <div class="meta">
          <span>${fmtDate(p.publishedAt)}</span>
          <span class="badge">인용 ${p.citations?.count ?? '-'}</span>
          <span>▲ ${p.upvotes}</span>
        </div>
        <div class="meta" style="margin-top:6px">${p.categories.map((c) => `<span class="tag">${esc(c)}</span>`).join('')}</div>
      </li>`
    )
    .join('') || '<li class="empty">조건에 맞는 논문이 없습니다.</li>';
}

/* ---------- 상세 ---------- */
function sentenceRows(items) {
  if (!items.length) return '<p class="ko">해당 문장이 초록에서 발견되지 않았습니다.</p>';
  return items
    .map(
      (s) => `<div class="sent">
        ${speakBtn(s.en, '문장 듣기')}
        <div class="body">
          <p class="en">${esc(s.en)}</p>
          ${s.ko ? `<p class="ko">${esc(s.ko)}</p>` : `<p class="ko"><button class="toggle" data-translate="${esc(s.en)}">한국어 번역</button></p>`}
        </div>
      </div>`
    )
    .join('');
}

function highlight(sentence, word) {
  const re = new RegExp(`\\b(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i');
  return esc(sentence).replace(re, '<mark>$1</mark>');
}

function renderDetail() {
  const p = state.papers.find((x) => x.id === state.selectedId);
  if (!p) return;
  const koToggle = `<button class="toggle ${state.showKo ? 'on' : ''}" data-action="toggle-ko">한국어 ${state.showKo ? 'ON' : 'OFF'}</button>`;
  $('#detail').innerHTML = `
    <article class="${state.showKo ? '' : 'hide-ko'}">
      <div class="meta" style="margin-bottom:8px">${p.categories.map((c) => `<span class="tag">${esc(c)}</span>`).join('')}</div>
      <h2>${esc(p.title)}</h2>
      <p class="authors">${esc(p.authors.slice(0, 10).join(', '))}${p.authors.length > 10 ? ` 외 ${p.authors.length - 10}명` : ''}</p>

      <div class="stats">
        <div class="stat"><div class="label">인용횟수</div><div class="value">${p.citations?.count ?? '-'}</div><div class="hint">${esc(p.citations?.source || '조회 실패')}</div></div>
        <div class="stat"><div class="label">HF 추천</div><div class="value">${p.upvotes}</div><div class="hint">upvotes</div></div>
        <div class="stat"><div class="label">게시일</div><div class="value" style="font-size:16px">${fmtDate(p.publishedAt)}</div><div class="hint">arXiv ${p.id}</div></div>
        ${p.githubStars != null ? `<div class="stat"><div class="label">GitHub ★</div><div class="value">${p.githubStars}</div><div class="hint">stars</div></div>` : ''}
      </div>

      <section class="section">
        <div class="section-head"><span class="dot"></span><h3>주제</h3><span class="spacer"></span>${koToggle}</div>
        ${p.aiSummary.en ? `<div class="summary-box">
          <p>${esc(p.aiSummary.en)}</p>${p.aiSummary.ko ? `<p class="ko">${esc(p.aiSummary.ko)}</p>` : ''}
        </div>` : ''}
        <div class="keywords">${p.keywords.map((k) => `<span class="tag">${esc(k)}</span>`).join('')}</div>
        ${p.sections.background.length ? `<div style="margin-top:10px">${sentenceRows(p.sections.background)}</div>` : ''}
      </section>

      <section class="section method">
        <div class="section-head"><span class="dot"></span><h3>방법론</h3></div>
        ${sentenceRows(p.sections.methodology)}
      </section>

      <section class="section result">
        <div class="section-head"><span class="dot"></span><h3>연구결과</h3></div>
        ${sentenceRows(p.sections.results)}
      </section>

      <section class="section">
        <div class="section-head"><span class="dot"></span><h3>영단어 · 예문</h3><span class="spacer"></span>
          <span class="sub">🔊 클릭으로 발음 듣기</span></div>
        <div class="vocab">
          ${p.vocab.map((v) => `<div class="word-card">
            <div class="word-top">${speakBtn(v.word, '단어 듣기')}<span class="word">${esc(v.word)}</span></div>
            ${v.ko ? `<div class="word-ko">${esc(v.ko)}</div>` : ''}
            <div class="example">${speakBtn(v.sentence, '예문 듣기')}<span>${highlight(v.sentence, v.word)}${v.sentenceKo ? `<span class="ko">${esc(v.sentenceKo)}</span>` : ''}</span></div>
          </div>`).join('')}
        </div>
      </section>

      <section class="section">
        <div class="section-head"><span class="dot"></span><h3>초록</h3><span class="spacer"></span>
          ${speakBtn(p.abstract.en, '초록 전체 듣기')}</div>
        <p class="abstract">${esc(p.abstract.en)}</p>
        ${p.abstract.ko ? `<p class="abstract ko" style="color:var(--text-2)">${esc(p.abstract.ko)}</p>` : ''}
      </section>

      <section class="section">
        <div class="section-head"><span class="dot"></span><h3>연결 링크</h3></div>
        <div class="links">
          <a class="link-btn" href="${p.links.hf}" target="_blank" rel="noopener">🤗 Hugging Face</a>
          <a class="link-btn" href="${p.links.arxiv}" target="_blank" rel="noopener">📄 arXiv</a>
          <a class="link-btn" href="${p.links.pdf}" target="_blank" rel="noopener">⬇ PDF</a>
          ${p.links.github ? `<a class="link-btn" href="${esc(p.links.github)}" target="_blank" rel="noopener">💻 GitHub</a>` : ''}
        </div>
      </section>
    </article>`;
  $('#detail').scrollTop = 0;
}

/* ---------- 채팅 ---------- */
const SUGGESTIONS = ['이 논문의 핵심 기여는?', '방법론을 쉽게 설명해줘', 'AI와 로봇이 맡은 역할은?', '한계점과 후속 연구는?'];

function renderChat() {
  const log = state.chats.get(state.selectedId) || [];
  $('#chatSuggest').innerHTML = SUGGESTIONS.map((s) => `<button data-ask="${esc(s)}">${esc(s)}</button>`).join('');
  $('#chatLog').innerHTML = log.length
    ? log.map((m) => `<div class="msg ${m.role} ${m.error ? 'error' : ''}">${m.role === 'assistant' ? md(m.content) : esc(m.content)}</div>`).join('')
    : '<div class="msg assistant">선택한 논문에 대해 무엇이든 물어보세요. 초록과 분석 내용을 바탕으로 한국어로 답합니다.</div>';
  $('#chatLog').scrollTop = $('#chatLog').scrollHeight;
}

async function ask(question) {
  const paperId = state.selectedId;
  if (!question.trim() || state.busy || !paperId) return;
  const log = state.chats.get(paperId) || [];
  state.chats.set(paperId, log);
  log.push({ role: 'user', content: question.trim() });
  const reply = { role: 'assistant', content: '' };
  log.push(reply);
  state.busy = true;
  $('#chatSend').disabled = true;
  renderChat();
  const bubble = $('#chatLog').lastElementChild;
  bubble.textContent = '생각 중…';
  // 무료 API는 첫 응답까지 수십 초 걸릴 수 있어 경과 시간 표시
  const started = Date.now();
  const timer = setInterval(() => {
    if (!reply.content && state.selectedId === paperId) bubble.textContent = `생각 중… ${Math.round((Date.now() - started) / 1000)}초`;
  }, 1000);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paperId, messages: log.filter((m) => m !== reply && !m.error) }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `오류 ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      reply.content += decoder.decode(value, { stream: true });
      if (state.selectedId === paperId) {
        bubble.innerHTML = md(reply.content);
        $('#chatLog').scrollTop = $('#chatLog').scrollHeight;
      }
    }
    if (!reply.content) throw new Error('빈 응답을 받았습니다.');
  } catch (err) {
    reply.content = `⚠ ${err.message}`;
    reply.error = true;
  } finally {
    clearInterval(timer);
    state.busy = false;
    $('#chatSend').disabled = false;
    if (state.selectedId === paperId) renderChat();
  }
}

/* ---------- 이벤트 ---------- */
function select(id) {
  state.selectedId = id;
  history.replaceState(null, '', `#${id}`);
  renderList();
  renderDetail();
  renderChat();
  if (window.innerWidth <= 760) $('#detail').scrollIntoView({ behavior: 'smooth' });
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-speak],[data-cat],[data-id],[data-ask],[data-action],[data-translate]');
  if (!t) return;
  if (t.dataset.speak) return speak(t.dataset.speak, t);
  if (t.dataset.cat) { state.category = t.dataset.cat; renderChips(); return renderList(); }
  if (t.dataset.id) return select(t.dataset.id);
  if (t.dataset.ask) return ask(t.dataset.ask);
  if (t.dataset.action === 'toggle-ko') { state.showKo = !state.showKo; return renderDetail(); }
  if (t.dataset.translate) {
    t.disabled = true;
    t.textContent = '번역 중…';
    try {
      const res = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t.dataset.translate }) });
      const data = await res.json();
      t.parentElement.textContent = data.ko || data.error || '번역 실패';
    } catch { t.textContent = '번역 실패'; t.disabled = false; }
  }
});
$('#paperList').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.id) select(e.target.dataset.id); });
$('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; renderList(); });
$('#chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#chatInput').value;
  $('#chatInput').value = '';
  ask(q);
});
$('#chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#chatForm').requestSubmit(); }
});
$('#chatOpen').addEventListener('click', () => $('#chat').classList.add('open'));
$('#chatClose').addEventListener('click', () => $('#chat').classList.remove('open'));

/* ---------- 초기화 ---------- */
async function init() {
  try {
    const data = await (await fetch('data/papers.json', { cache: 'no-cache' })).json();
    state.papers = data.papers;
    $('#updatedAt').textContent = `최근 수집 ${new Date(data.updatedAt).toLocaleString('ko-KR')}`;
  } catch {
    $('#detail').innerHTML = '<div class="empty">논문 데이터를 불러오지 못했습니다. 수집 스크립트를 먼저 실행하세요.</div>';
    return;
  }
  renderChips();
  const fromHash = location.hash.slice(1);
  const first = state.papers.find((p) => p.id === fromHash) || filtered()[0];
  if (first) select(first.id);
  else renderList();
}
init();
