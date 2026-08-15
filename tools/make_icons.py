#!/usr/bin/env python3
"""Generate the extension icons from a 16x16 pixel map (no dependencies)."""
import os
import struct
import zlib

ART = [
    "................",
    "..KK........KK..",
    ".KBBK......KBBK.",
    ".KBPBK....KBPBK.",
    ".KBBBBBBBBBBBBK.",
    ".KBBBBBBBBBBBBK.",
    ".KBBWKBBBBWKBBK.",
    ".KBBKKBBBBKKBBK.",
    ".KBBKKBBBBKKBBK.",
    ".KBBBLLLLLLBBBK.",
    ".KBBBLLPPLLBBBK.",
    ".KBBBLLLLLLBBBK.",
    "..KBBBBBBBBBBK..",
    "...KKBBBBBBKK...",
    ".....KKKKKK.....",
    "................",
]

PALETTE = {
    ".": (0, 0, 0, 0),
    "K": (0x3B, 0x2B, 0x28, 255),
    "B": (0xF4, 0xA2, 0x59, 255),
    "L": (0xFF, 0xE2, 0xC4, 255),
    "P": (0xFF, 0x98, 0xAD, 255),
    "W": (0xFF, 0xFF, 0xFF, 255),
}


def chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def write_png(path, rows):
    height = len(rows)
    width = len(rows[0])
    raw = b"".join(b"\x00" + bytes(c for px in row for c in px) for row in rows)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(png)


def scaled(factor):
    rows = []
    for line in ART:
        row = []
        for ch in line:
            row.extend([PALETTE[ch]] * factor)
        rows.extend([row] * factor)
    return rows


def main():
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
    os.makedirs(out, exist_ok=True)
    for size in (16, 32, 48, 128):
        assert size % 16 == 0, size
        write_png(os.path.join(out, "icon%d.png" % size), scaled(size // 16))
        print("wrote icons/icon%d.png" % size)


if __name__ == "__main__":
    for i, line in enumerate(ART):
        assert len(line) == 16, "row %d is %d wide" % (i, len(line))
    assert len(ART) == 16
    main()
