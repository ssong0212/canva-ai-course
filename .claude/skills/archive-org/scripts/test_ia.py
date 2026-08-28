#!/usr/bin/env python3
"""ia.py 오프라인 테스트 — 실제 archive.org 응답 형태를 고정 데이터로 재현한다.

네트워크가 막힌 환경에서도 파싱·선택 로직을 검증할 수 있다.

  python3 test_ia.py
"""
import io
import contextlib
import json
import sys
import types

import ia

FAILED = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  — ' + detail if detail and not cond else ''}")
    if not cond:
        FAILED.append(label)


def run(fn, args, responses):
    """_fetch 를 고정 응답으로 갈아끼우고 명령을 실행, stdout 을 돌려준다."""
    calls = []

    def fake_fetch(url, *, raw=False, timeout=60):
        calls.append(url)
        r = responses[min(len(calls) - 1, len(responses) - 1)]
        return r

    real, ia._fetch = ia._fetch, fake_fetch
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            fn(types.SimpleNamespace(**args))
    finally:
        ia._fetch = real
    return buf.getvalue(), calls


# --- 실제 응답 형태 --------------------------------------------------------- #
SEARCH = {
    "responseHeader": {"status": 0, "QTime": 41},
    "response": {
        "numFound": 2103,
        "start": 0,
        "docs": [
            {"identifier": "DuckandC1951", "title": "Duck and Cover", "year": "1951",
             "downloads": 1216349,
             "licenseurl": "http://creativecommons.org/publicdomain/mark/1.0/"},
            # licenseurl 없음 — "확인 필요" 로 나와야 한다
            {"identifier": "AreYouPop1947", "title": ["Are You Popular?"], "year": "1947",
             "downloads": 388215},
        ],
    },
}

SCRAPE_P1 = {"items": [{"identifier": f"disc{i}", "title": f"Record {i}", "year": "1928"}
                       for i in range(100)],
             "count": 100, "cursor": "W3siaWRlbnRpZmllciI6", "total": 250}
SCRAPE_P2 = {"items": [{"identifier": f"disc{i}", "title": f"Record {i}", "year": "1928"}
                       for i in range(100, 150)],
             "count": 50, "total": 250}  # cursor 없음 = 끝

META = {
    "created": 1724800000,
    "dir": "/7/items/DuckandC1951",
    "files": [
        {"name": "DuckandC1951.mpeg", "source": "original", "format": "MPEG2",
         "size": "342135300", "length": "548.0"},
        {"name": "DuckandC1951_512kb.mp4", "source": "derivative", "format": "512Kb MPEG4",
         "size": "35651584", "length": "548.05"},
        {"name": "DuckandC1951.gif", "source": "derivative", "format": "Animated GIF",
         "size": "204800"},
        {"name": "DuckandC1951_meta.xml", "source": "original", "format": "Metadata",
         "size": "1876"},
    ],
    "metadata": {
        "identifier": "DuckandC1951", "title": "Duck and Cover",
        "creator": "Archer Productions", "date": "1951", "mediatype": "movies",
        "collection": ["prelinger", "moviesandfilms"],
        "licenseurl": "http://creativecommons.org/publicdomain/mark/1.0/",
        "description": ["Classroom film.", "Bert the Turtle."],  # 리스트로 오는 경우
    },
    "server": "ia903103.us.archive.org",
}

WAYBACK = {
    "url": "example.com",
    "archived_snapshots": {"closest": {
        "status": "200", "available": True,
        "url": "http://web.archive.org/web/20150102030405/http://example.com/",
        "timestamp": "20150102030405"}},
}

print("search — 응답 파싱")
out, calls = run(ia.cmd_search,
                 dict(query="collection:prelinger", rows=50, page=1,
                      sort="downloads desc", json=False), [SEARCH])
check("identifier 출력", "DuckandC1951" in out)
check("licenseurl 없으면 '확인 필요'", "확인 필요" in out)
check("리스트 title 을 평문으로", "Are You Popular?" in out and "['" not in out)
check("건수 요약", "2건" in out)
check("fl[] 파라미터 전송", "fl%5B%5D=identifier" in calls[0])
check("정렬 파라미터 전송", "sort%5B%5D=downloads+desc" in calls[0])

print("search — 빈 결과")
out, _ = run(ia.cmd_search,
             dict(query="asdfqwerzxcv", rows=50, page=1, sort="downloads desc", json=False),
             [{"response": {"docs": []}}])
check("쿼리를 넓히라고 안내", "넓혀라" in out)

print("scrape — cursor 페이징")
out, calls = run(ia.cmd_scrape, dict(query="collection:78rpm", max=150, json=False),
                 [SCRAPE_P1, SCRAPE_P2])
check("두 페이지 요청", len(calls) == 2, f"{len(calls)}회 호출")
check("cursor 를 다음 요청에 전달", "cursor=" in calls[1])
check("count=100 (최소값 준수)", "count=100" in calls[0])
check("max 까지만 수집", "150건" in out)

print("scrape — cursor 없이 한 페이지로 끝")
out, calls = run(ia.cmd_scrape, dict(query="x", max=1000, json=False), [SCRAPE_P2])
check("무한 루프 없이 종료", len(calls) == 1)

print("meta — 상세 출력")
out, _ = run(ia.cmd_meta, dict(identifier="DuckandC1951", json=False), [META])
check("라이선스 출력", "publicdomain/mark" in out)
check("details 링크 출력", "archive.org/details/DuckandC1951" in out)
check("리스트 description 처리", "Bert the Turtle" in out)
check("크기 사람이 읽게 변환", "326.3MB" in out or "MB" in out)

print("pick — 원본이 아니라 파생본")
out, _ = run(ia.cmd_pick, dict(identifier="DuckandC1951", kind="video"), [META])
check("512Kb MPEG4 선택", "DuckandC1951_512kb.mp4" in out)
check("MPEG2 원본 회피", "DuckandC1951.mpeg\n" not in out)
check("다운로드 URL 구성", "archive.org/download/DuckandC1951/DuckandC1951_512kb.mp4" in out)

print("wayback")
out, _ = run(ia.cmd_wayback, dict(url="example.com", timestamp="20150101"), [WAYBACK])
check("스냅샷 타임스탬프", "20150102030405" in out)
check("web.archive.org 차단 가능성 안내", "web.archive.org" in out)

print("pick — 파생본별 선호 순서")
check("h.264 를 MPEG2 보다 우선",
      ia.pick_file([{"name": "a.mpeg", "format": "MPEG2"},
                    {"name": "a.mp4", "format": "h.264"}], "video")["name"] == "a.mp4")
check("VBR MP3 를 FLAC 보다 우선",
      ia.pick_file([{"name": "a.flac", "format": "Flac"},
                    {"name": "a.mp3", "format": "VBR MP3"}], "audio")["name"] == "a.mp3")
check("파생본 없으면 None",
      ia.pick_file([{"name": "a.zip", "format": "ZIP"}], "video") is None)

print("파일명 인코딩")
check("공백·괄호 인코딩",
      ia.download_url("my id", "a b (1).mp4")
      == "https://archive.org/download/my%20id/a%20b%20%281%29.mp4")

print()
if FAILED:
    print(f"{len(FAILED)}개 실패: {', '.join(FAILED)}")
    sys.exit(1)
print("전부 통과")
