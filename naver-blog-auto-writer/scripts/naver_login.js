#!/usr/bin/env node
/**
 * naver_login.js — 네이버 로그인 1회 (세션은 naver-profile/에 저장, 비밀번호는 저장하지 않음)
 *
 * 사용법: node scripts/naver_login.js
 * 브라우저가 뜨면 사용자가 직접 로그인한다 (패스키 가능). 로그인이 확인되면 자동 종료.
 */
const { chromium } = require('playwright');
const path = require('path');

const PROFILE_DIR = path.join(__dirname, '..', 'naver-profile');

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1600, height: 1000 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  // 이미 로그인돼 있으면 바로 종료
  const already = (await ctx.cookies('https://naver.com')).some((c) => c.name === 'NID_AUT');
  if (already) {
    console.log('✅ 이미 로그인돼 있습니다 (naver-profile/ 세션 유효).');
    await ctx.close();
    return;
  }

  await page.goto('https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fblog.naver.com');
  console.log('▶ 브라우저 창에서 직접 로그인하세요 (패스키 로그인도 됩니다).');
  console.log('  비밀번호는 이 툴에 저장되지 않습니다 — 브라우저 세션만 naver-profile/에 남습니다.');

  // 로그인 완료(NID_AUT 쿠키)까지 대기 — 최대 10분
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const cookies = await ctx.cookies('https://naver.com').catch(() => []);
    if (cookies.some((c) => c.name === 'NID_AUT')) {
      console.log('✅ 로그인 확인 — 세션이 naver-profile/에 저장됐습니다.');
      console.log('⚠️  naver-profile/ 폴더는 로그인 세션이므로 절대 외부 공유 금지.');
      await page.waitForTimeout(2000);
      await ctx.close();
      return;
    }
    await page.waitForTimeout(2000).catch(() => {});
  }
  console.error('시간 초과 — 로그인이 확인되지 않았습니다. 다시 실행해 주세요.');
  await ctx.close();
  process.exit(1);
})().catch((e) => {
  console.error('실행 실패:', e.message);
  process.exit(1);
});
