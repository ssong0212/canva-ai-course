# Pixel Pets 🐱

브라우저 안에서 픽셀 펫이 살아 움직이는 Chrome 확장 프로그램입니다.
페이지 아래쪽을 걸어 다니고, 앉고, 자고, 마우스 커서를 쫓아오고,
집어서 던질 수도 있습니다.

Chrome 웹스토어의 *Pets for Chrome* 같은 확장을 처음부터 직접 만든 버전이고,
**이미지 에셋이 하나도 없습니다.** 모든 스프라이트를 코드로 픽셀 하나씩 그리기 때문에
색·크기·동작을 마음대로 바꿀 수 있습니다.

| | |
|---|---|
| 펫 | 고양이 · 강아지 · 토끼 · 병아리 |
| 동작 | idle / walk / run / sit / sleep / happy / drag / fall |
| 조작 | 클릭 = 쓰다듬기 💕 · 드래그 = 들어 옮기기 · 더블클릭 = 점프 |

## 설치 (개발자 모드)

1. 이 저장소를 클론하거나 ZIP으로 내려받습니다.
2. Chrome에서 `chrome://extensions` 를 엽니다.
3. 오른쪽 위 **개발자 모드**를 켭니다.
4. **압축해제된 확장 프로그램을 로드** → 이 폴더(`manifest.json`이 있는 폴더)를 선택합니다.
5. 아무 웹페이지나 열면 왼쪽 아래에서 펫이 걸어 나옵니다.

툴바 아이콘을 누르면 펫 종류, 크기, 속도, 커서 추적을 바꿀 수 있고
설정은 열려 있는 모든 탭에 바로 반영됩니다.

## 구조

```
manifest.json         Manifest V3 정의
src/pets.js           픽셀 스프라이트 (32×32 그리드에 코드로 드로잉)
src/content.js        페이지 위의 펫 — 상태 머신 + 물리 + 마우스 상호작용
src/popup.html/.css/.js  설정 팝업 (미리보기 애니메이션 포함)
src/background.js     설치 시 기본 설정값 저장
icons/                툴바 아이콘 (tools/make_icons.py 로 생성)
tools/                개발용 스크립트 (아래 참고)
```

### 동작 방식 요약

- **스프라이트**: `src/pets.js`가 32×32 픽셀 그리드에 `fillRect` 로 몸통·머리·다리·꼬리를
  직접 그립니다. 다리 스윙, 꼬리 흔들기, 눈 깜빡임, 하트, 💤 는 모두 시간(`t`) 함수라서
  프레임 이미지가 필요 없습니다.
- **펫 엔진**: `src/content.js`가 Shadow DOM 안에 캔버스를 하나 띄우고
  30fps 루프에서 상태 머신(어슬렁 → 앉기 → 낮잠 → 커서 추격)과
  중력·던지기 물리를 돌립니다. Shadow DOM이라 페이지 CSS의 영향을 받지 않습니다.
- **설정**: `chrome.storage.sync` 에 저장하고 `onChanged` 로 모든 탭이 즉시 반응합니다.

## 개발

```bash
# 스프라이트 시트 미리보기 (브라우저에서 열기)
open tools/preview.html

# 툴바 아이콘 다시 생성
python3 tools/make_icons.py

# 실제 Chromium에 확장을 로드해서 자동 검증 (Playwright 필요)
NODE_PATH=$(npm root -g) node tools/e2e.js --shots /tmp/shots
```

`tools/e2e.js` 는 펫이 실제로 마운트되는지, 바닥에 서는지, 혼자 걸어 다니는지,
커서를 쫓는지, 드래그·낙하가 되는지, 설정이 실시간 반영되는지, 팝업이 에러 없이
뜨는지를 확인합니다.

## 펫 추가하기

`src/pets.js` 의 `PETS` 에 항목을 하나 넣고 `ORDER` 에 id를 추가하면 끝입니다.
네발 동물이면 `kind: 'quad'` 에 귀(`pointy`/`floppy`/`long`), 꼬리(`long`/`stub`/`puff`),
무늬(`stripes`/`patch`/`none`)와 색 팔레트만 지정하면 모든 동작이 자동으로 붙습니다.

```js
fox: {
  id: 'fox', name: 'Fox', emoji: '🦊', kind: 'quad',
  ear: 'pointy', tail: 'long', pattern: 'none',
  c: { body:'#ef7d3a', dark:'#c85d24', light:'#ffe9d6', line:'#3b2b28', nose:'#43302c' }
}
```

## 쏭컷 (SongCut)

공백 0초 컷편집 클로드 스킬 + 웹 편집기 + 랜딩페이지는 [`songcut/`](songcut/README.md) 폴더에 있습니다.
