#!/usr/bin/env node
/**
 * probe_selectors.js — 셀렉터 진단용 DOM 덤프 (읽기 전용 — 저장·발행 클릭 없음)
 *
 * 사용법: node scripts/probe_selectors.js [--html]
 *
 * 네이버가 셀렉터를 바꿔서 naver_draft.js가 실패할 때, 추측으로 고치지 말고
 * 이 스크립트로 실제 DOM을 실측한 뒤 수정한다.
 * 결과: drafts/probe-<시각>.json (+ --html 시 전체 HTML), 스크린샷 1장.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROFILE_DIR = path.join(ROOT, 'naver-profile');
const SAVE_HTML = process.argv.includes('--html');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1600, height: 1000 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  // 읽기 전용이지만 발행 가드는 동일하게 설치 (절대 규칙 2)
  await page.addInitScript(() => {
    window.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest && e.target.closest('button[data-testid="seOnePublishBtn"]');
      if (btn) { e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
  });

  console.log('▶ 에디터 진입...');
  await page.goto('https://blog.naver.com/GoBlogWrite.naver', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(6000);

  let scope = page;
  for (const f of page.frames()) {
    try { if (await f.$('.se-content, .se-components-wrap, .se-main-container')) { scope = f; break; } } catch (_) {}
  }

  // "작성 중인 글" 팝업 → 새로 쓰기
  try {
    const cancel = scope.locator('.se-popup-button-cancel').first();
    if (await cancel.isVisible({ timeout: 3000 })) await cancel.click();
  } catch (_) {}

  const probe = await scope.evaluate(() => {
    const info = {
      inIframe: window !== window.top,
      title: { selector: '.se-title-text', found: !!document.querySelector('.se-title-text') },
      body: {
        selector: '.se-section-text p.se-text-paragraph',
        count: document.querySelectorAll('.se-section-text p.se-text-paragraph').length,
      },
      toolbarButtons: [...document.querySelectorAll('.se-toolbar button, [class*="toolbar"] button')]
        .slice(0, 120)
        .map((b) => ({ class: b.className, text: (b.textContent || '').trim().slice(0, 20), title: b.title || '' })),
      publishButtons: [...document.querySelectorAll('button')]
        .filter((b) => /발행|저장/.test(b.textContent || '') || b.dataset.testid === 'seOnePublishBtn')
        .map((b) => ({ class: b.className, text: (b.textContent || '').trim().slice(0, 20), testid: b.dataset.testid || '' })),
      dims: [...document.querySelectorAll('[class*="dim"]')].map((d) => d.className).slice(0, 10),
    };
    return info;
  });

  const jsonPath = path.join(ROOT, 'drafts', `probe-${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(probe, null, 2));
  console.log(`✅ ${path.relative(ROOT, jsonPath)}`);

  if (SAVE_HTML) {
    const html = await scope.evaluate(() => document.documentElement.outerHTML);
    const htmlPath = path.join(ROOT, 'drafts', `probe-${stamp}.html`);
    fs.writeFileSync(htmlPath, html);
    console.log(`✅ ${path.relative(ROOT, htmlPath)}`);
  }

  const shotPath = path.join(ROOT, 'drafts', `probe-${stamp}.png`);
  await page.screenshot({ path: shotPath });
  console.log(`✅ ${path.relative(ROOT, shotPath)}`);
  console.log('\n툴바 버튼 클래스 상위 20개:');
  probe.toolbarButtons.slice(0, 20).forEach((b) => console.log(`  ${b.class}  "${b.text}"`));

  await ctx.close();
})().catch((e) => {
  console.error('실행 실패:', e);
  process.exit(1);
});
