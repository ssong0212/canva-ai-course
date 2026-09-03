---
description: 네이버 로그인 (세션 저장 — 최초 1회, 로그인이 풀렸을 때 재실행)
---

1. `node scripts/naver_login.js` 를 실행한다.
2. 브라우저 창이 뜨면 사용자가 직접 로그인한다고 안내한다 (패스키 로그인도 됨). 비밀번호는 저장되지 않고 브라우저 세션만 naver-profile/에 남는다.
3. 스크립트가 "로그인 확인"을 출력하면 완료 보고. naver-profile/ 폴더는 외부 공유 금지임을 함께 안내한다.
4. 실패(시간 초과 등) 시 에러 메시지를 보고 원인을 진단한다 — playwright 미설치면 `npm install` + `npx playwright install chromium` 안내.
