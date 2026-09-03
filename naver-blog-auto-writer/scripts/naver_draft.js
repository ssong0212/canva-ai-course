#!/usr/bin/env node
/**
 * naver_draft.js — 초안 JSON을 네이버 스마트에디터 ONE에 입력하고 "임시저장"까지 수행
 *
 * 사용법:
 *   node scripts/naver_draft.js drafts/2026-01-01-제목.json [--dry-run]
 *
 *   --dry-run : 저장 클릭만 생략 (셀렉터 디버깅 중 "저장 글"에 실패본이 쌓이지 않게)
 *
 * 절대 규칙 2: 발행 금지 — installPublishGuard가 진짜 발행 버튼
 * (button[data-testid="seOnePublishBtn"]) 클릭을 캡처 단계에서 원천 차단한다.
 * 어떤 경우에도 이 가드를 제거하지 않는다.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROFILE_DIR = path.join(ROOT, 'naver-profile');
const DRY_RUN = process.argv.includes('--dry-run');
const draftPath = process.argv.slice(2).find((a) => a.endsWith('.json'));

if (!draftPath || !fs.existsSync(draftPath)) {
  console.error('사용법: node scripts/naver_draft.js drafts/파일.json [--dry-run]');
  process.exit(1);
}
const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// 자동 처리 결과 집계 → 마지막에 "자동 처리 결과" 블록으로 출력
const results = { 본문: '❗수동 필요', 소제목: '해당 없음', 사진: '해당 없음', 동영상: '해당 없음', 지도: '해당 없음', 태그: '해당 없음', 제목: '❗수동 필요', 임시저장: DRY_RUN ? '건너뜀(--dry-run)' : '❗수동 필요' };

// ---------- 헬퍼 ----------

// 한글은 insertText (type()은 IME 조합이 꼬임), 이모지는 별도 호출로 분리 삽입
const EMOJI_RE = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)/gu;
async function insertText(page, text) {
  const parts = text.split(EMOJI_RE).filter((s) => s.length > 0);
  for (const part of parts) {
    await page.keyboard.insertText(part);
    await page.waitForTimeout(30);
  }
}

// 여러 줄 텍스트: 줄마다 insertText + Enter
async function insertLines(page, text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await insertText(page, lines[i]);
    if (i < lines.length - 1) await page.keyboard.press('Enter');
  }
}

// 에디터가 iframe 안에 있을 수도, 페이지 직속일 수도 있다
async function editorScope(page) {
  for (const frame of page.frames()) {
    try {
      if (await frame.$('.se-content, .se-components-wrap, .se-main-container')) return frame;
    } catch (_) { /* detach 중인 프레임 무시 */ }
  }
  return page;
}

// 절대 규칙 2: 발행 원천 차단 가드 (제거 금지)
async function installPublishGuard(page) {
  await page.addInitScript(() => {
    window.addEventListener('click', (e) => {
      const t = e.target;
      const btn = t && t.closest && t.closest('button[data-testid="seOnePublishBtn"]');
      if (btn) {
        e.stopImmediatePropagation();
        e.preventDefault();
        console.warn('[발행 가드] 발행 버튼 클릭을 차단했습니다. 발행은 항상 사람이 직접.');
      }
    }, true); // 캡처 단계
  });
}

// 툴바 버튼 클릭 (실측 클래스 우선, 실패 시 에러)
async function clickToolbar(scope, cls, label) {
  const btn = scope.locator(`button.${cls}, button[class*="${cls}"]`).first();
  await btn.click({ timeout: 8000 });
  return label;
}

// 본문 마지막 문단으로 캐럿 복귀 (.se-section-text 로 한정 — 제목 오염 방지)
async function focusLastParagraph(scope) {
  await scope.locator('.se-section-text p.se-text-paragraph').last().click({ timeout: 8000 });
}

// 문단 서식 드롭다운으로 서식 지정 후 라벨 재확인 (볼드 토글 금지)
async function setTextFormat(scope, page, label) {
  await scope.locator('button[class*="se-text-format-toolbar-button"]').first().click();
  await page.waitForTimeout(300);
  await scope.locator('.se-toolbar [class*="se-toolbar-option"] button, [class*="se-toolbar-option"]')
    .filter({ hasText: label }).first().click();
  await page.waitForTimeout(300);
  const applied = (await scope.locator('button[class*="se-text-format-toolbar-button"]').first().textContent()) || '';
  return applied.includes(label);
}

async function setFontSize19(scope, page) {
  try {
    await scope.locator('button[class*="se-font-size-code-toolbar-button"]').first().click();
    await page.waitForTimeout(300);
    await scope.locator('button[class*="fs19"]').first().click();
    await page.waitForTimeout(200);
    return true;
  } catch (e) {
    console.warn('  · 크기 fs19 적용 실패(계속 진행):', e.message.split('\n')[0]);
    return false;
  }
}

// 팝업 dim 잔류 제거 폴백 — 안 닫힌 dim은 이후 모든 클릭을 가로챈다
async function forceRemoveDim(scope) {
  try {
    await scope.evaluate(() => {
      document.querySelectorAll('.se-popup-dim, [class*="se-popup-dim"], [class*="se_popup_dim"]').forEach((el) => el.remove());
    });
  } catch (_) { /* noop */ }
}

// ---------- 메인 ----------

(async () => {
  if (!fs.existsSync(PROFILE_DIR)) {
    console.error('naver-profile/ 이 없습니다. 먼저 /setup-login (node scripts/naver_login.js) 을 실행하세요.');
    process.exit(1);
  }

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1600, height: 1000 }, // 1400 이하에서는 속성 툴바가 잘림
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  await installPublishGuard(page);

  console.log('▶ 에디터 진입...');
  await page.goto('https://blog.naver.com/GoBlogWrite.naver', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(5000);

  let scope = await editorScope(page);

  // "작성 중인 글" 팝업 → 새로 쓰기
  try {
    const cancel = scope.locator('.se-popup-button-cancel').first();
    if (await cancel.isVisible({ timeout: 3000 })) {
      await cancel.click();
      console.log('  · "작성 중인 글" 팝업 → 새로 쓰기');
    }
  } catch (_) { /* 팝업 없음 */ }

  await scope.locator('.se-section-text p.se-text-paragraph').first().waitFor({ timeout: 20000 });

  // ── 1. 본문 입력 (제목보다 먼저! — 레이스 컨디션 방지) ──
  console.log('▶ 본문 입력...');
  await focusLastParagraph(scope);

  // video는 항상 첫 text 블록 직후 삽입 → 블록 시퀀스에 끼워넣기
  const blocks = [...draft.blocks];
  if (draft.video && draft.video.path) {
    const firstText = blocks.findIndex((b) => b.type === 'text');
    blocks.splice(firstText + 1, 0, { type: '_video', ...draft.video });
  }

  let subtitleOk = true, subtitleCount = 0, imageCount = 0, imageFail = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const next = blocks[i + 1];

    if (block.type === 'text') {
      await insertLines(page, block.text);
      await page.keyboard.press('Enter');
      // text 블록이 연달아 오면 빈 줄 없이 붙는다 → 다음도 text일 때만 Enter 한 번 더
      if (next && next.type === 'text') await page.keyboard.press('Enter');

    } else if (block.type === 'subtitle') {
      subtitleCount++;
      // 순서가 핵심: 서식 → 크기 → 텍스트 입력
      const fmtOk = await setTextFormat(scope, page, '소제목').catch(() => false);
      if (!fmtOk) subtitleOk = false;
      await setFontSize19(scope, page);
      await insertLines(page, block.text);
      await page.keyboard.press('Enter');
      // 다음 문단은 "본문"으로 명시 복귀 + 라벨 재확인
      const backOk = await setTextFormat(scope, page, '본문').catch(() => false);
      if (!backOk) subtitleOk = false;

    } else if (block.type === 'quote') {
      try {
        await clickToolbar(scope, 'se-insert-quotation-default-toolbar-button', '인용구');
        await page.waitForTimeout(500);
        await insertText(page, block.text);
        await page.keyboard.press('ArrowDown'); // 인용구 밖으로
        await focusLastParagraph(scope);
      } catch (e) {
        console.warn('  · 인용구 실패 → 일반 텍스트로 대체:', e.message.split('\n')[0]);
        await focusLastParagraph(scope);
        await insertLines(page, `" ${block.text} "`);
        await page.keyboard.press('Enter');
      }

    } else if (block.type === 'divider') {
      try {
        await clickToolbar(scope, 'se-insert-horizontal-line-default-toolbar-button', '구분선');
        await page.waitForTimeout(500);
        await focusLastParagraph(scope);
      } catch (e) {
        console.warn('  · 구분선 실패(건너뜀):', e.message.split('\n')[0]);
      }

    } else if (block.type === 'image') {
      const imgPath = path.isAbsolute(block.path) ? block.path : path.join(ROOT, block.path);
      if (!fs.existsSync(imgPath)) {
        console.warn(`  · 사진 없음(건너뜀): ${block.path}`);
        imageFail++;
        continue;
      }
      try {
        const [chooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 10000 }),
          scope.locator('button[class*="se-image-toolbar-button"]').first().click(),
        ]);
        await chooser.setFiles(imgPath);
        await page.waitForTimeout(4000); // 업로드 대기
        imageCount++;
        // 캡션 (선택) — 실패해도 진행
        if (block.caption) {
          try {
            await scope.locator('.se-component.se-image').last().click();
            await page.waitForTimeout(300);
            await scope.locator('.se-component.se-image .se-caption, .se-caption').last().click({ timeout: 3000 });
            await insertText(page, block.caption);
          } catch (_) {
            console.warn('  · 캡션 입력 실패(수동 권장):', block.caption);
          }
        }
        await focusLastParagraph(scope);
      } catch (e) {
        imageFail++;
        console.warn('  · 사진 업로드 실패:', e.message.split('\n')[0]);
        await focusLastParagraph(scope).catch(() => {});
      }

    } else if (block.type === '_video') {
      results.동영상 = await attachVideo(page, scope, block).catch((e) => {
        console.warn('  · 동영상 실패:', e.message.split('\n')[0]);
        return '❗수동 필요';
      });
      await forceRemoveDim(scope);
      await focusLastParagraph(scope).catch(() => {});
    }
  }

  results.본문 = '✅';
  if (subtitleCount > 0) results.소제목 = subtitleOk ? `✅ ${subtitleCount}개` : '❗수동 확인 필요(서식 라벨 검증 실패)';
  if (imageCount + imageFail > 0) results.사진 = imageFail === 0 ? `✅ ${imageCount}장` : `❗ ${imageCount}장 성공 / ${imageFail}장 실패`;

  // ── 2. 지도(플레이스) — 글 맨 끝 ──
  if (draft.place && draft.place.query) {
    results.지도 = await attachPlace(page, scope, draft.place).catch((e) => {
      console.warn('  · 지도 실패:', e.message.split('\n')[0]);
      return '❗수동 필요';
    });
    await forceRemoveDim(scope);
    await focusLastParagraph(scope).catch(() => {});
  }

  // ── 3. 제목 — 맨 마지막에 입력, 읽어서 검증, 불일치면 재입력 ──
  console.log('▶ 제목 입력...');
  scope = await editorScope(page);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await scope.locator('.se-title-text').first().click();
    if (attempt > 1) {
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('Delete');
    }
    await insertText(page, draft.title);
    await page.waitForTimeout(500);
    const actual = ((await scope.locator('.se-title-text').first().textContent()) || '').trim();
    if (actual === draft.title.trim()) { results.제목 = '✅'; break; }
    console.warn(`  · 제목 불일치(시도 ${attempt}): "${actual}" → 재입력`);
    results.제목 = '❗수동 확인 필요';
  }

  // ── 4. 본문 첫 줄 누락 검사 → 누락이면 맨 앞에 보정 삽입 ──
  const firstTextBlock = draft.blocks.find((b) => b.type === 'text');
  if (firstTextBlock) {
    const head = firstTextBlock.text.split('\n')[0].slice(0, 12);
    const bodyText = await scope.evaluate(() =>
      [...document.querySelectorAll('.se-section-text p.se-text-paragraph')].map((p) => p.textContent).join('\n'));
    if (head && !bodyText.includes(head)) {
      console.warn('  · 본문 첫 줄 누락 감지 → 맨 앞에 보정 삽입');
      await scope.locator('.se-section-text p.se-text-paragraph').first().click();
      await page.keyboard.press('Home');
      await insertText(page, firstTextBlock.text.split('\n')[0]);
      await page.keyboard.press('Enter');
      results.본문 = '✅ (첫 줄 보정 삽입)';
    }
  }

  // ── 5. 태그 — 발행 패널 열기(가드가 진짜 발행은 차단) → 입력 → Escape ──
  if (Array.isArray(draft.tags) && draft.tags.length > 0) {
    results.태그 = await inputTags(page, scope, draft.tags).catch((e) => {
      console.warn('  · 태그 실패:', e.message.split('\n')[0]);
      return '❗수동 필요';
    });
  }

  // ── 6. 임시저장 ──
  if (DRY_RUN) {
    console.log('▶ --dry-run: 저장 클릭 생략');
  } else {
    console.log('▶ 임시저장...');
    try {
      // 우상단 "저장" 버튼 (발행 버튼과 다름 — 발행은 가드가 차단)
      await page.locator('button:has-text("저장")').first().click({ timeout: 8000 });
      await page.waitForTimeout(3000);
      results.임시저장 = '✅';
    } catch (e) {
      console.warn('  · 저장 버튼 클릭 실패:', e.message.split('\n')[0]);
      results.임시저장 = '❗수동 필요';
    }
  }

  // ── 7. 이중 검증: 스크린샷 + 전체 텍스트 덤프 ──
  console.log('▶ 검증 덤프 생성...');
  scope = await editorScope(page);
  const dump = await scope.evaluate(() => {
    const title = (document.querySelector('.se-title-text') || {}).textContent || '';
    const body = [...document.querySelectorAll('.se-main-container .se-component, .se-components-wrap .se-component')]
      .map((c) => c.textContent.trim()).filter(Boolean).join('\n---\n');
    return { title: title.trim(), body };
  });
  const base = path.basename(draftPath, '.json');
  const dumpPath = path.join(ROOT, 'drafts', `${base}-dump-${stamp}.txt`);
  fs.writeFileSync(dumpPath, `[제목]\n${dump.title}\n\n[본문]\n${dump.body}\n`);
  const shotPath = path.join(ROOT, 'drafts', `${base}-shot-${stamp}.png`);
  await page.screenshot({ path: shotPath, fullPage: false });

  // 간이 대조 (전문 대조는 Claude가 덤프 파일을 Read로 열어 수행)
  let mismatches = 0;
  for (const b of draft.blocks) {
    if (b.type !== 'text' && b.type !== 'subtitle' && b.type !== 'quote') continue;
    for (const line of b.text.split('\n').filter(Boolean)) {
      if (!dump.body.includes(line)) { mismatches++; console.warn(`  ✗ 본문 누락 의심: ${line.slice(0, 40)}`); }
    }
  }

  // ── 자동 처리 결과 ──
  console.log('\n══════ 자동 처리 결과 ══════');
  for (const [k, v] of Object.entries(results)) console.log(`  ${k}: ${v}`);
  console.log(`  간이 대조: ${mismatches === 0 ? '✅ 누락 없음' : `❗ ${mismatches}줄 누락 의심`}`);
  console.log(`  텍스트 덤프: ${path.relative(ROOT, dumpPath)}  ← 초안과 전문 대조(본검증)`);
  console.log(`  스크린샷:   ${path.relative(ROOT, shotPath)}`);
  console.log('════════════════════════════\n');

  await ctx.close();
  if (mismatches > 0) process.exit(2); // 불일치 시 성공 보고 금지
})().catch((e) => {
  console.error('실행 실패:', e);
  console.error('→ 셀렉터 문제로 보이면: node scripts/probe_selectors.js 로 실제 DOM을 실측 후 수정하세요.');
  process.exit(1);
});

// ---------- 동영상 ----------
async function attachVideo(page, scope, video) {
  console.log('▶ 동영상 업로드...');
  const vidPath = path.isAbsolute(video.path) ? video.path : path.join(ROOT, video.path);
  if (!fs.existsSync(vidPath)) { console.warn('  · 영상 파일 없음:', video.path); return '❗수동 필요(파일 없음)'; }
  const title = (video.title || draft.title || '블로그 동영상').slice(0, 40);

  await scope.locator('button[class*="se-video-toolbar-button"]').first().click();
  await page.waitForTimeout(1500);

  // 팝업의 "동영상 추가" 버튼이 파일 선택창을 띄운다
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    scope.locator('button:has-text("동영상 추가"), [class*="upload"] button').first().click(),
  ]);
  await chooser.setFiles(vidPath);
  console.log('  · 업로드 중 (수 분 걸릴 수 있음)...');

  // 제목 입력란 (40자 제한)
  const titleInput = scope.locator('.se-popup input[type="text"], [class*="popup"] input[type="text"]').first();
  await titleInput.waitFor({ timeout: 300000 }); // 인코딩 대기
  await titleInput.fill(title);

  // 완료/확인
  await scope.locator('.se-popup button:has-text("완료"), .se-popup button:has-text("확인")').first().click({ timeout: 300000 });
  await page.waitForTimeout(2000);

  // 팝업 확실히 닫기 — 실패 시 dim 강제 제거
  try {
    const close = scope.locator('.se-popup [class*="close"]').first();
    if (await close.isVisible({ timeout: 1500 })) await close.click();
  } catch (_) { /* 이미 닫힘 */ }
  await forceRemoveDim(scope);
  return '✅';
}

// ---------- 지도(플레이스) ----------
async function attachPlace(page, scope, place) {
  console.log('▶ 지도(플레이스) 첨부...');
  await scope.locator('button[class*="se-map-toolbar-button"], button[class*="se-place-toolbar-button"]').first().click();
  await page.waitForTimeout(1500);

  const search = scope.locator('.se-popup input[type="text"], [class*="se-map"] input').first();
  await search.click();
  await search.fill(place.query);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);

  const items = scope.locator('.se-popup li, [class*="se-map"] li');
  const count = await items.count();
  if (count === 0) {
    console.warn(`  · 검색 0건: "${place.query}" → 수동 첨부 필요`);
    await closePlacePopup(scope);
    return '❗수동 필요(검색 0건)';
  }

  // 선택: 공백 제거 정확 일치 → 부분 포함 → 첫 결과
  const want = (place.name || place.query).replace(/\s/g, '');
  let pick = items.first();
  for (let i = 0; i < Math.min(count, 10); i++) {
    const t = ((await items.nth(i).textContent()) || '').replace(/\s/g, '');
    if (t === want) { pick = items.nth(i); break; }
    if (t.includes(want) && i === 0) pick = items.nth(i);
  }

  // "추가" 버튼은 hover 전에는 not visible → hover 후 클릭, 폴백은 DOM 직접 click
  await pick.hover();
  await page.waitForTimeout(400);
  const addBtn = pick.locator('button:has-text("추가")').first();
  try {
    await addBtn.click({ timeout: 4000 });
  } catch (_) {
    await addBtn.evaluate((el) => el.click());
  }
  await page.waitForTimeout(600);

  // "추가" 후에야 확인 버튼이 enabled 된다
  await scope.locator('.se-popup button:has-text("확인")').first().click({ timeout: 8000 });
  await page.waitForTimeout(1500);

  await closePlacePopup(scope);
  return '✅';
}

// 장소 팝업은 Escape로 안 닫힌다 → 반드시 닫기 버튼, 실패 시 dim 강제 제거
async function closePlacePopup(scope) {
  try {
    const close = scope.locator('.se-popup [class*="close"]').first();
    if (await close.isVisible({ timeout: 1500 })) await close.click();
  } catch (_) { /* 이미 닫힘 */ }
  await forceRemoveDim(scope);
}

// ---------- 태그 ----------
async function inputTags(page, scope, tags) {
  console.log('▶ 태그 입력 (발행 패널 — 발행 버튼은 가드가 차단 중)...');
  // 우상단 발행 버튼으로 패널만 연다
  await page.locator('button:has-text("발행")').first().click({ timeout: 8000 });
  await page.waitForTimeout(1500);

  const input = page.locator('input#tag-input').first();
  await input.waitFor({ timeout: 8000 });

  const clean = tags.map((t) => t.replace(/^#+/, '').trim()).filter(Boolean).slice(0, 30);
  for (const tag of clean) {
    await input.click();
    await page.keyboard.insertText(tag);
    await page.keyboard.press('Enter'); // 칩 확정
    await page.waitForTimeout(250);
  }

  // 검증: 태그 영역 텍스트를 #로 쪼개 센다 (칩 클래스는 해시가 바뀌므로 의존 금지)
  const areaText = await page.evaluate(() => {
    const el = document.querySelector('input#tag-input');
    return el && el.closest('div') ? el.closest('div').parentElement.textContent : '';
  });
  const chipCount = areaText.split('#').filter((s) => s.trim()).length;

  // Escape로 패널만 닫기 → 그 다음에 임시저장
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  return chipCount >= clean.length ? `✅ ${clean.length}개` : `❗확인 필요(입력 ${clean.length} / 감지 ${chipCount})`;
}
