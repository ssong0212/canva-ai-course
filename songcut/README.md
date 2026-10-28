# 쏭컷 (SongCut) — 공백 0초 컷편집

말하는 영상의 공백을 자동으로 잘라 내고, 쇼츠(9:16)·첫 3초 제목·한글 자막으로 바꾸는 도구 묶음입니다.

| 폴더 | 무엇 | 확인 방법 |
|---|---|---|
| `npm/` | 클로드 코드 스킬 `songcut` + 한 줄 설치기 (`npx --yes creimeta-songcut`) | `cd npm && node cli.mjs --self-test` |
| `npm/skill/songcut/` | 스킬 본체 — `doctor` · `info` · `cut` · `shorts` (ffmpeg 사용) | `node songcut.mjs doctor` |
| `web/index.html` | 판매·공유용 랜딩페이지 (패키지 3종) | 브라우저로 열기 |
| `web/editor.html` | 브라우저 웹 편집기 (업로드 없음, 파형·구간 토글·쇼츠·자막·내보내기) | 브라우저로 열기 |
| `web/memories.html` | 추억 영상 만들기 — 사진·동영상을 날짜순 정리, 하이라이트 구간 고르기, 자동 보정, 제목·자막·음악 | 브라우저로 열기 |
| `web/config.js` | **가격·결제 링크·문의처** — 판매 전 여기만 고치면 됩니다 | — |

## 판매 전에 할 일

1. `web/config.js` — 가격(지금은 예시), 결제 링크(`link`), 문의처(`contact`)를 넣습니다.
2. `npm/brand.mjs` — 설치가 끝난 뒤 보여 줄 랜딩페이지 주소를 넣습니다.
3. 랜딩페이지 배포 — `web/` 폴더를 Netlify · Vercel · GitHub Pages 중 한 곳에 올립니다(빌드 필요 없음).
4. npm 배포 — `cd npm && npm login && npm publish` (이름 `creimeta-songcut` 은 2026-10-28 기준 비어 있었습니다).

## 로컬에서 보기

```
cd songcut/web
python3 -m http.server 8000      # → http://localhost:8000
```
