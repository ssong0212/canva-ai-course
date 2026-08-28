#!/usr/bin/env python3
"""archive.org 공개 API 헬퍼 — API 키 없이 익명 GET만 사용한다.

표준 라이브러리만 쓴다. 설치할 것 없음.

  ia.py search "collection:prelinger" --rows 20
  ia.py scrape "collection:78rpm" --max 500
  ia.py meta <identifier>
  ia.py pick <identifier> --kind video
  ia.py get  <identifier> <filename> -o out/
  ia.py clip <identifier> --start 180 --dur 3 -o out.mp4
  ia.py wayback example.com --timestamp 20150101
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

UA = "claude-archive-org-skill/1.0 (+https://archive.org/help/aboutsearch.htm)"
DELAY = 0.3  # 연속 호출 사이 간격(초). 공짜 서비스다.
_last_call = 0.0


def _fetch(url, *, raw=False, timeout=60):
    """GET 한 번. 요청 간격을 강제하고, 정책 차단은 명확히 보고한다."""
    global _last_call
    wait = DELAY - (time.time() - _last_call)
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
    except urllib.error.HTTPError as e:
        die(f"HTTP {e.code} — {url}")
    except urllib.error.URLError as e:
        die(
            f"연결 실패 — {url}\n  {e.reason}\n"
            "  프록시가 403 CONNECT를 돌려줬다면 조직 egress 정책이 archive.org를\n"
            "  차단한 것이다. 재시도하거나 우회하지 말고 사용자에게 보고하라."
        )
    finally:
        _last_call = time.time()
    return data if raw else json.loads(data)


def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def details_url(ident):
    return f"https://archive.org/details/{ident}"


def download_url(ident, filename):
    return (
        "https://archive.org/download/"
        f"{urllib.parse.quote(ident)}/{urllib.parse.quote(filename)}"
    )


def table(rows, headers):
    """의존성 없는 정렬된 표 출력."""
    if not rows:
        print("(결과 없음 — 쿼리를 좁히지 말고 넓혀라: 컬렉션 한정 해제, 따옴표 제거, 동의어 추가)")
        return
    cols = [list(map(str, col)) for col in zip(headers, *rows)]
    widths = [min(max(len(v) for v in col), 60) for col in cols]

    def line(vals):
        cells = []
        for v, w in zip(vals, widths):
            v = str(v)
            cells.append((v[: w - 1] + "…" if len(v) > w else v).ljust(w))
        return "  ".join(cells).rstrip()

    print(line(headers))
    print("  ".join("-" * w for w in widths))
    for r in rows:
        print(line(r))


# --------------------------------------------------------------------------- #
# 1) advancedsearch
# --------------------------------------------------------------------------- #
def cmd_search(a):
    fields = ["identifier", "title", "year", "downloads", "licenseurl"]
    q = [("q", a.query), ("rows", str(a.rows)), ("page", str(a.page)),
         ("output", "json"), ("sort[]", a.sort)]
    q += [("fl[]", f) for f in fields]
    url = "https://archive.org/advancedsearch.php?" + urllib.parse.urlencode(q)
    docs = _fetch(url)["response"]["docs"]
    if a.json:
        print(json.dumps(docs, ensure_ascii=False, indent=2))
        return
    table(
        [
            [
                d.get("identifier", ""),
                flat(d.get("title")),
                d.get("year", ""),
                d.get("downloads", ""),
                (d.get("licenseurl") or "확인 필요"),
            ]
            for d in docs
        ],
        ["identifier", "title", "year", "downloads", "license"],
    )
    print(f"\n{len(docs)}건. 상세 링크: archive.org/details/<identifier>")


# --------------------------------------------------------------------------- #
# 2) scrape (대량)
# --------------------------------------------------------------------------- #
def cmd_scrape(a):
    out, cursor = [], None
    while len(out) < a.max:
        params = {"q": a.query, "fields": "identifier,title,year", "count": 100}
        if cursor:
            params["cursor"] = cursor
        body = _fetch(
            "https://archive.org/services/search/v1/scrape?"
            + urllib.parse.urlencode(params)
        )
        out.extend(body.get("items", []))
        cursor = body.get("cursor")
        if not cursor:
            break
    out = out[: a.max]
    if a.json:
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        table(
            [[i.get("identifier", ""), flat(i.get("title")), i.get("year", "")] for i in out],
            ["identifier", "title", "year"],
        )
        print(f"\n{len(out)}건")


# --------------------------------------------------------------------------- #
# 3) metadata
# --------------------------------------------------------------------------- #
def get_meta(ident):
    body = _fetch(f"https://archive.org/metadata/{urllib.parse.quote(ident)}")
    if not body.get("metadata"):
        die(f"'{ident}' 항목이 없거나 비어 있다.")
    return body


def cmd_meta(a):
    body = get_meta(a.identifier)
    if a.json:
        print(json.dumps(body, ensure_ascii=False, indent=2))
        return
    m = body["metadata"]
    print(f"title    : {flat(m.get('title'))}")
    print(f"creator  : {flat(m.get('creator'))}")
    print(f"date     : {flat(m.get('date') or m.get('year'))}")
    print(f"license  : {m.get('licenseurl') or '없음 — 컬렉션 성격으로 판단, 애매하면 확인 필요'}")
    print(f"source   : {details_url(a.identifier)}")
    desc = flat(m.get("description"))
    if desc:
        print(f"desc     : {desc[:300]}")
    print()
    files = body.get("files", [])
    table(
        [
            [f.get("name", ""), f.get("format", ""),
             human(f.get("size")), f.get("length", "")]
            for f in files
        ],
        ["name", "format", "size", "length"],
    )
    print(f"\n{len(files)}개 파일. 원본이 아니라 파생본을 골라라 — `ia.py pick {a.identifier}`")


def flat(v):
    """archive.org 는 같은 필드를 문자열로도 리스트로도 돌려준다."""
    if isinstance(v, list):
        return " / ".join(str(x) for x in v)
    return "" if v is None else str(v)


def human(n):
    try:
        n = float(n)
    except (TypeError, ValueError):
        return ""
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f}{unit}" if unit == "B" else f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"


# --------------------------------------------------------------------------- #
# pick — 파생본 선택
# --------------------------------------------------------------------------- #
# 선호 순서. 앞쪽일수록 먼저 고른다. 원본(MPEG2, FLAC, WAV)은 의도적으로 제외.
PREFER = {
    "video": ["512kb mpeg4", "h.264", "mpeg4", "ogg video"],
    "audio": ["vbr mp3", "128kbps mp3", "64kbps mp3", "mp3"],
    "text": ["text pdf", "djvutxt", "djvu txt", "pdf"],
    "image": ["jpeg", "jpg", "png", "jpeg thumb"],
}


def pick_file(files, kind):
    prefs = PREFER.get(kind) or die(f"알 수 없는 kind: {kind} (video|audio|text|image)")
    for want in prefs:
        for f in files:
            if f.get("format", "").strip().lower() == want:
                return f
    for want in prefs:  # 정확히 일치하는 게 없으면 부분 일치
        for f in files:
            if want in f.get("format", "").strip().lower():
                return f
    return None


def cmd_pick(a):
    body = get_meta(a.identifier)
    f = pick_file(body.get("files", []), a.kind)
    if not f:
        die(f"'{a.identifier}' 에 {a.kind} 파생본이 없다. `ia.py meta {a.identifier}` 로 전체 목록 확인.")
    lic = body["metadata"].get("licenseurl") or "확인 필요"
    print(f"file    : {f['name']}")
    print(f"format  : {f.get('format', '')}   size: {human(f.get('size'))}   length: {f.get('length', '')}")
    print(f"url     : {download_url(a.identifier, f['name'])}")
    print(f"license : {lic}")
    print(f"source  : {details_url(a.identifier)}")


# --------------------------------------------------------------------------- #
# 4) download + 검증
# --------------------------------------------------------------------------- #
def verify(path):
    """파일 존재 여부만 보고 넘어가지 마라 — 중단된 다운로드는 정상처럼 보인다."""
    size = os.path.getsize(path)
    if size < 1024:
        die(f"{path}: {size}B 밖에 안 된다 — 다운로드가 잘렸다.")
    probe = shutil.which("ffprobe")
    if probe and path.lower().endswith(
        (".mp4", ".mpg", ".mpeg", ".avi", ".mkv", ".ogv", ".mp3", ".ogg", ".flac", ".wav")
    ):
        r = subprocess.run(
            [probe, "-v", "error", "-show_entries",
             "format=duration:stream=width,height,codec_name",
             "-of", "default=noprint_wrappers=1", path],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            die(f"{path}: ffprobe 실패 — 파일이 손상됐다.\n{r.stderr.strip()}")
        info = " ".join(r.stdout.split())
        print(f"verified: {human(size)}  {info}")
    else:
        print(f"verified: {human(size)}")


def cmd_get(a):
    url = download_url(a.identifier, a.filename)
    out = a.out
    if os.path.isdir(out) or out.endswith("/"):
        os.makedirs(out, exist_ok=True)
        out = os.path.join(out, os.path.basename(a.filename))
    elif os.path.dirname(out):
        os.makedirs(os.path.dirname(out), exist_ok=True)
    print(f"GET {url}")
    data = _fetch(url, raw=True, timeout=600)
    with open(out, "wb") as fh:
        fh.write(data)
    verify(out)
    print(f"saved   : {out}")
    print(f"source  : {details_url(a.identifier)}")


# --------------------------------------------------------------------------- #
# clip — HTTP Range 로 구간만
# --------------------------------------------------------------------------- #
def cmd_clip(a):
    if not shutil.which("ffmpeg"):
        die("ffmpeg 이 없다.")
    body = get_meta(a.identifier)
    name = a.file or (pick_file(body.get("files", []), "video") or {}).get("name")
    if not name:
        die(f"'{a.identifier}' 에 영상 파생본이 없다.")
    url = download_url(a.identifier, name)
    # -ss 를 -i 앞에 둬야 Range 요청으로 필요한 구간만 받아온다.
    cmd = ["ffmpeg", "-y", "-ss", str(a.start), "-i", url,
           "-t", str(a.dur), "-c:v", "copy", "-c:a", "copy", a.out]
    print(" ".join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        # 스트림 복사가 안 되는 코덱이면 재인코딩으로 한 번 더.
        cmd = ["ffmpeg", "-y", "-ss", str(a.start), "-i", url, "-t", str(a.dur), a.out]
        print("stream copy 실패 — 재인코딩:", " ".join(cmd))
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            die(f"ffmpeg 실패:\n{r.stderr[-2000:]}")
    verify(a.out)
    print(f"source  : {details_url(a.identifier)}")


# --------------------------------------------------------------------------- #
# 5) Wayback
# --------------------------------------------------------------------------- #
def cmd_wayback(a):
    params = {"url": a.url}
    if a.timestamp:
        params["timestamp"] = a.timestamp
    body = _fetch("https://archive.org/wayback/available?" + urllib.parse.urlencode(params))
    snap = (body.get("archived_snapshots") or {}).get("closest")
    if not snap:
        die(f"'{a.url}' 스냅샷이 없다.")
    print(f"timestamp: {snap.get('timestamp')}")
    print(f"status   : {snap.get('status')}")
    print(f"url      : {snap.get('url')}")
    print("\n※ web.archive.org 가 막힌 환경이면 위 URL 을 직접 열 수 없다. 사용자에게 알려라.")


def main():
    global DELAY
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--delay", type=float, default=DELAY, help="요청 간격(초), 기본 0.3")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("search", help="advancedsearch")
    s.add_argument("query")
    s.add_argument("--rows", type=int, default=50)
    s.add_argument("--page", type=int, default=1)
    s.add_argument("--sort", default="downloads desc",
                   help="downloads desc | publicdate desc | titleSorter asc")
    s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_search)

    s = sub.add_parser("scrape", help="대량 수집 (수천 건)")
    s.add_argument("query")
    s.add_argument("--max", type=int, default=1000)
    s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_scrape)

    s = sub.add_parser("meta", help="항목 상세·파일 목록")
    s.add_argument("identifier")
    s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_meta)

    s = sub.add_parser("pick", help="받아야 할 파생본 고르기")
    s.add_argument("identifier")
    s.add_argument("--kind", default="video", choices=list(PREFER))
    s.set_defaults(fn=cmd_pick)

    s = sub.add_parser("get", help="파일 다운로드 + 검증")
    s.add_argument("identifier")
    s.add_argument("filename")
    s.add_argument("-o", "--out", default=".")
    s.set_defaults(fn=cmd_get)

    s = sub.add_parser("clip", help="HTTP Range 로 구간만 잘라오기")
    s.add_argument("identifier")
    s.add_argument("--start", type=float, required=True, help="시작 초")
    s.add_argument("--dur", type=float, default=3, help="길이 초")
    s.add_argument("--file", help="파일명 직접 지정 (기본: 영상 파생본 자동 선택)")
    s.add_argument("-o", "--out", default="clip.mp4")
    s.set_defaults(fn=cmd_clip)

    s = sub.add_parser("wayback", help="가장 가까운 과거 스냅샷")
    s.add_argument("url")
    s.add_argument("--timestamp", help="YYYYMMDD 또는 YYYYMMDDhhmmss")
    s.set_defaults(fn=cmd_wayback)

    a = p.parse_args()
    DELAY = a.delay
    a.fn(a)


if __name__ == "__main__":
    main()
