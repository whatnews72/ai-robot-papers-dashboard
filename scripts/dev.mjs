// 로컬 개발 서버: public/ 정적 파일 + api/*.js 함수를 Vercel과 같은 방식으로 실행
// 실행: node --env-file=.env scripts/dev.mjs  (기본 포트 3000)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z-]/gi, '');
      const { default: handler } = await import(pathToFileURL(join(ROOT, 'api', `${name}.js`)).href);
      let raw = '';
      for await (const chunk of req) raw += chunk;
      req.body = raw ? JSON.parse(raw) : {};
      return await handler(req, res);
    }
    const file = resolve(ROOT, 'public', '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(join(ROOT, 'public'))) throw new Error('forbidden');
    const body = await readFile(file);
    // 개발 중 수정 사항이 바로 보이도록 캐시 비활성화
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (err) {
    if (!res.headersSent) res.writeHead(err.code === 'ENOENT' ? 404 : 500);
    res.end(String(err.message));
  }
}).listen(PORT, () => console.log(`대시보드: http://localhost:${PORT}`));
