#!/usr/bin/env node
/**
 * mosaic.js — 사진 속 개인정보(타인 얼굴·차량 번호판·전화번호 등) 모자이크 처리
 *
 * 사용법: node scripts/mosaic.js drafts/mosaic-spec.json
 *
 * spec 포맷 (좌표는 EXIF 회전 보정 후 화면 기준 0~1 상대값, 15% 여유 포함해서 작성):
 * {
 *   "items": [
 *     {
 *       "image": "input/photos/IMG_001.jpg",
 *       "regions": [
 *         { "x": 0.62, "y": 0.10, "w": 0.18, "h": 0.22, "reason": "타인 얼굴" }
 *       ]
 *     }
 *   ]
 * }
 *
 * - 처리본은 input/photos/_mosaic/ 에 생성 — 원본은 절대 덮어쓰지 않는다.
 * - sharp는 한 파이프라인에 resize 1회만 적용되므로 축소→버퍼→확대(nearest) 2단계로 분리한다.
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'input', 'photos', '_mosaic');
const PIXEL = 16; // 모자이크 픽셀 크기(축소 배율)

const specPath = process.argv[2];
if (!specPath || !fs.existsSync(specPath)) {
  console.error('사용법: node scripts/mosaic.js drafts/mosaic-spec.json');
  process.exit(1);
}
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const items = spec.items || [spec]; // 단일 항목도 허용

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let done = 0, regionsDone = 0;

  for (const item of items) {
    const srcPath = path.isAbsolute(item.image) ? item.image : path.join(ROOT, item.image);
    if (!fs.existsSync(srcPath)) {
      console.error(`✗ 파일 없음: ${item.image}`);
      continue;
    }

    // 좌표 기준을 "보이는 화면"과 맞추기 위해 반드시 EXIF 회전 보정 후 버퍼로 확정
    const rotated = await sharp(srcPath).rotate().toBuffer();
    const meta = await sharp(rotated).metadata();
    const W = meta.width, H = meta.height;

    const composites = [];
    for (const r of item.regions || []) {
      const left = clamp(Math.round(r.x * W), 0, W - 1);
      const top = clamp(Math.round(r.y * H), 0, H - 1);
      const width = clamp(Math.round(r.w * W), 1, W - left);
      const height = clamp(Math.round(r.h * H), 1, H - top);

      // 1단계: 영역 추출 → 축소 (파이프라인 resize 1회)
      const small = await sharp(rotated)
        .extract({ left, top, width, height })
        .resize(Math.max(1, Math.round(width / PIXEL)), Math.max(1, Math.round(height / PIXEL)), { fit: 'fill' })
        .toBuffer();
      // 2단계: 새 파이프라인에서 nearest로 확대 (파이프라인 resize 1회)
      const pixelated = await sharp(small)
        .resize(width, height, { fit: 'fill', kernel: 'nearest' })
        .toBuffer();

      composites.push({ input: pixelated, left, top });
      regionsDone++;
      console.log(`  · ${path.basename(item.image)} [${left},${top} ${width}x${height}] — ${r.reason || '사유 미기재'}`);
    }

    const outPath = path.join(OUT_DIR, path.basename(srcPath));
    await sharp(rotated).composite(composites).toFile(outPath);
    done++;
    console.log(`✅ ${path.relative(ROOT, outPath)}`);
  }

  console.log(`\n처리 완료: 사진 ${done}장 / 영역 ${regionsDone}곳`);
  console.log('→ 처리본을 Read로 열어 실제로 가려졌는지 반드시 확인하세요. 덜 가려졌으면 좌표를 키워 재실행.');
})().catch((e) => {
  console.error('실행 실패:', e);
  process.exit(1);
});
