// PWA 앱 아이콘 생성: 파란 배경 + 흰 로봇 머리 → public/icons/*.png
// 외부 패키지 없이 거리 함수로 도형을 그리고 node:zlib으로 PNG 인코딩
// 실행: npm run icons

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const BLUE = [49, 130, 246]; // --accent
const WHITE = [255, 255, 255];

// 부호 있는 거리 함수 (좌표는 0~1 정규화, 음수 = 도형 안쪽)
const roundBox = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const circle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;

// 로봇 머리 도형 목록 [거리 함수, 색] — 뒤에 올수록 위에 그림
const ROBOT = [
  [(x, y) => roundBox(x, y, 0.5, 0.25, 0.018, 0.08, 0.018), WHITE], // 안테나 대
  [(x, y) => circle(x, y, 0.5, 0.19, 0.05), WHITE], // 안테나 공
  [(x, y) => roundBox(x, y, 0.5, 0.56, 0.28, 0.22, 0.09), WHITE], // 머리
  [(x, y) => roundBox(x, y, 0.2, 0.56, 0.04, 0.08, 0.03), WHITE], // 왼쪽 귀
  [(x, y) => roundBox(x, y, 0.8, 0.56, 0.04, 0.08, 0.03), WHITE], // 오른쪽 귀
  [(x, y) => circle(x, y, 0.395, 0.52, 0.055), BLUE], // 왼쪽 눈
  [(x, y) => circle(x, y, 0.605, 0.52, 0.055), BLUE], // 오른쪽 눈
  [(x, y) => roundBox(x, y, 0.5, 0.66, 0.1, 0.022, 0.022), BLUE], // 입
];

// maskable: 배경을 꽉 채우고 그림을 안전 영역(가운데 80%) 안으로 축소
function render(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const scale = maskable ? 0.72 : 1;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) / size, y = (j + 0.5) / size;
      // 1픽셀 폭으로 경계를 부드럽게(안티에일리어싱)
      const cover = (d) => Math.min(Math.max(0.5 - d * size, 0), 1);
      const bg = maskable ? 1 : cover(roundBox(x, y, 0.5, 0.5, 0.5, 0.5, 0.22));
      let c = BLUE;
      const sx = (x - 0.5) / scale + 0.5, sy = (y - 0.5) / scale + 0.5;
      for (const [shape, color] of ROBOT) {
        const a = cover(shape(sx, sy) * scale);
        if (a > 0) c = c.map((v, k) => v * (1 - a) + color[k] * a);
      }
      px.set([...c.map(Math.round), Math.round(bg * 255)], (j * size + i) * 4);
    }
  }
  return encodePng(size, px);
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type), data]);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8비트 RGBA
  // 각 행 앞에 필터 바이트(0) 추가
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let j = 0; j < size; j++) rgba.copy(raw, j * (size * 4 + 1) + 1, j * size * 4, (j + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true]]) {
  writeFileSync(join(OUT, name), render(size, maskable));
  console.log(`생성: public/icons/${name}`);
}
