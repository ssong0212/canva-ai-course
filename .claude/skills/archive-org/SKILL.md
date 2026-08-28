---
name: archive-org
description: Internet Archive(archive.org) 공개 API를 API 키 없이 익명 GET으로 직접 호출해 퍼블릭 도메인/CC 자료를 검색·수집·다운로드한다. 영상·오디오·책·이미지 파생본(derivative) 선택, HTTP Range를 이용한 구간만 잘라내기, Wayback Machine 과거 스냅샷 조회를 포함한다. 트리거 — "archive.org에서 찾아줘", "인터넷 아카이브", "퍼블릭 도메인 영상/음원/이미지 구해줘", "Prelinger", "NASA 아카이브 영상", "1950년대 교육영화", "78rpm 재즈 음원", "옛날 신문/광고 이미지", "Wayback으로 예전 홈페이지 찾아줘", "웨이백 머신", 저작권 걱정 없는 소재를 실제로 받아와야 하는 모든 경우.
---

# Archive.org API 활용

Internet Archive 공개 API를 **코드로 직접 호출**한다. 별도의 검색/다운로드 도구를 찾지 마라.

**API 키·회원가입·토큰이 전혀 필요 없다.** 전부 익명 GET으로 동작한다.
"API 키가 없어서 못 한다"고 말하지 마라 — 없어도 된다.

## 사전 확인: 네트워크 정책

실행 환경에 따라 `archive.org` 자체가 egress 정책으로 막혀 있을 수 있다.
작업을 시작하기 전에 한 번 확인한다:

```bash
curl -s -o /dev/null -w "%{http_code}\n" --max-time 15 https://archive.org/metadata/prelinger
```

- `200` → 정상. 진행한다.
- `000` + `CONNECT tunnel failed, response 403` → **조직 egress 정책 차단**이다.
  재시도하거나 우회하지 말고, 사용자에게 "이 환경에서는 archive.org가 차단되어 있다"고
  보고한 뒤 무엇을 대신 할 수 있는지(쿼리·계획만 작성 등) 제시한다.

## 헬퍼 스크립트

`scripts/ia.py` 가 아래 API를 전부 감싸고 있다. 표준 라이브러리만 쓰므로 설치가 필요 없다.

```bash
python3 scripts/ia.py search "collection:prelinger AND subject:education" --rows 20
python3 scripts/ia.py scrape "collection:78rpm" --max 500
python3 scripts/ia.py meta <identifier>
python3 scripts/ia.py pick <identifier> --kind video      # 받아야 할 파생본 고르기
python3 scripts/ia.py get  <identifier> <파일명> -o out/  # 검증까지 포함한 다운로드
python3 scripts/ia.py clip <identifier> --start 180 --dur 3 -o out.mp4   # 구간만
python3 scripts/ia.py wayback example.com --timestamp 20150101
```

스크립트는 요청 사이에 0.3초를 쉬고(`--delay` 로 조정), 다운로드한 파일은
크기·`ffprobe` 로 검증한다. 직접 curl/urllib을 쓸 때도 같은 규칙을 지킨다.

## 1) 검색 — advancedsearch

```
https://archive.org/advancedsearch.php
  ?q=<쿼리>
  &fl[]=identifier&fl[]=title&fl[]=year&fl[]=downloads&fl[]=licenseurl
  &rows=50&page=1&output=json
  &sort[]=downloads desc
```

응답 `response.docs[]` — 각 항목의 **`identifier`가 이후 모든 호출의 열쇠**다.

- `rows` 최대 10000이지만 실무에선 50~200. 더 필요하면 `page`를 넘기거나 scrape를 쓴다.
- 정렬: `downloads desc`(인기·보존상태 좋은 것 우선) / `publicdate desc`(최신) / `titleSorter asc`

## 2) 대량 수집 — scrape (수천 건 이상)

```
https://archive.org/services/search/v1/scrape?q=<쿼리>&fields=identifier,title,year&count=100
```

- `count`는 **최소 100** (그보다 작으면 RangeException).
- 응답의 `cursor`를 `&cursor=<값>`으로 넘기며 페이징한다.
- 전체 컬렉션을 훑을 때만 쓴다.

## 3) 항목 상세·파일 목록 — metadata

```
https://archive.org/metadata/<identifier>
```

- `metadata{}` — title, creator, date, **licenseurl**, description
- `files[]` — 각 파일의 `name` `format` `size` `length`(초)

파일은 여러 파생본(derivative)으로 존재한다. **원본 대신 파생본을 골라라.**

| 종류 | 고를 format | 비고 |
|---|---|---|
| 영상 | `512Kb MPEG4` (대개 320x240) / `h.264` | 원본 MPEG2는 수백 MB — 특별한 이유 없으면 쓰지 마라 |
| 오디오 | `VBR MP3` / `128Kbps MP3` | 원본 FLAC은 불필요하게 크다 |
| 책 | `Text PDF` / `DjVuTXT`(순수 텍스트) | 전문 검색·인용은 DjVuTXT |
| 이미지 | `JPEG` / `JPEG Thumb` | |

## 4) 파일 받기 — download

```
https://archive.org/download/<identifier>/<파일명>
```

파일명에 공백·특수문자가 있으면 `urllib.parse.quote`로 인코딩한다.

### ⭐ 큰 미디어는 통째로 받지 마라

archive.org는 HTTP Range를 지원한다. `ffmpeg`의 `-ss`를 `-i` **앞**에 두면
필요한 구간만 받아온다. 10분짜리 영상에서 3초 뽑는 데 1~2초면 끝난다.

```bash
ffmpeg -ss 180 -i "https://archive.org/download/<id>/<id>_512kb.mp4" -t 3 -c:v copy out.mp4
```

## 5) Wayback Machine (과거 웹페이지)

```
https://archive.org/wayback/available?url=example.com&timestamp=20100101   # 가장 가까운 스냅샷
http://web.archive.org/web/20100101000000/http://example.com/              # 직접 열기
http://web.archive.org/cdx/search/cdx?url=example.com&output=json&limit=50 # 스냅샷 목록
```

※ 일부 실행 환경은 `web.archive.org` 도메인을 막아둔다. 차단되면
`archive.org/wayback/available` 쪽만 쓰거나, 사용자에게 환경 제약을 알린다.

## 검색 문법 치트시트

Lucene 문법이다. 필드를 붙일수록 결과가 정확해진다.

```
mediatype:(movies|audio|texts|image|software|web)
collection:prelinger              컬렉션 한정
subject:"World War II"            주제어(따옴표로 구문)
title:jazz  creator:"Duke Ellington"
date:[1930-01-01 TO 1949-12-31]   기간
licenseurl:*publicdomain*         라이선스 있는 것만
AND / OR / NOT / ( )              조합
```

## 쓸 만한 컬렉션

| 컬렉션 | 내용 |
|---|---|
| `prelinger` | 20세기 미국 광고·교육·산업 필름 (퍼블릭 도메인) |
| `universal_newsreels` | 1929~67 뉴스릴 |
| `usnationalarchives` | 미국 국립기록보관소 |
| `78rpm` / `audio_music` | 78회전 음반, 초기 재즈·스윙 |
| `netlabels` | CC 라이선스 현대 음악 |
| `librivoxaudio` | 퍼블릭 도메인 오디오북 |
| `americana` / `gutenberg` | 고서·텍스트 |
| `nasa` / `nasaimages` | NASA 영상·이미지 |
| `opensource_movies` | 사용자 업로드 영상 (라이선스 제각각 — 반드시 확인) |

## 반드시 지킬 것

1. **라이선스를 확인하고 보고한다.** `metadata.licenseurl`을 읽어라. 없으면 그 컬렉션의
   성격으로 판단하고(prelinger·78rpm·정부기관물 = 대개 퍼블릭 도메인), 애매하면 사용자에게
   "확인 필요"라고 말한다. CC 라이선스면 출처 표기 의무를 결과물에 반영한다.
2. **결과에는 항상 `identifier`와 원본 링크(`archive.org/details/<id>`)를 남긴다.**
   나중에 출처를 되짚을 수 있어야 한다.
3. **연속 호출은 사이를 띄운다.** 수십 건을 돌릴 때 병렬 3~5, 요청 간 0.2~0.5초.
   공짜 서비스다.
4. **받은 파일은 검증한다.** 영상은 `ffprobe`로 길이·해상도, 이미지는 크기를 확인한다.
   중단된 다운로드가 정상 파일처럼 남아 있는 경우가 흔하다 — 파일 존재 여부만 보고 넘어가지 마라.
5. **검색이 비면 쿼리를 좁히지 말고 넓혀라.** 컬렉션 한정을 풀고, 따옴표를 빼고, 동의어를 넣는다.

## 작업 방식

1. 사용자의 요청을 검색 쿼리 2~4개로 옮긴다(컬렉션·주제·기간을 달리해서).
2. 후보를 뽑아 **identifier / 제목 / 연도 / 다운로드 수**를 표로 보여주고, 무엇을 쓸지 정한다.
3. `metadata`로 파일을 고르고, 필요한 만큼만 받는다.
4. 결과와 함께 **출처 목록**(제목 · `archive.org/details/<id>` · 연도 · 라이선스)을 낸다.

## 요청 예시

- "1950년대 미국 교육영화 중 다운로드 많은 것 10편 찾아서 표로 보여줘"
- "NASA 아폴로 미션 영상에서 발사 장면만 5초씩 잘라 모아줘"
- "퍼블릭 도메인 재즈 음원 20곡 받아서 BPM 분석하고 빠른 순으로 정렬해줘"
- "1930년대 신문 광고 이미지 모아서 콘택트시트 만들어줘"
- "우리 회사 홈페이지가 2015년에 어떻게 생겼었는지 Wayback으로 찾아줘"
