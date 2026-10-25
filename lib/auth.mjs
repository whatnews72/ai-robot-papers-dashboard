// API 개인 접근 코드 검사 — APP_PASSCODE 환경변수가 있으면 X-App-Passcode 헤더가 일치해야 통과
// APP_PASSCODE가 비어 있으면(로컬 개발 등) 검사하지 않음

import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s) => createHash('sha256').update(s).digest();

export function checkAccess(req, res) {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return true;
  let given = '';
  try { given = decodeURIComponent(req.headers['x-app-passcode'] || ''); } catch { /* 잘못된 인코딩은 불일치 처리 */ }
  // 길이가 달라도 비교 시간이 같도록 해시로 맞춘 뒤 비교
  if (given && timingSafeEqual(digest(given), digest(expected))) return true;
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: '접근 코드가 필요합니다.', needPasscode: true }));
  return false;
}
