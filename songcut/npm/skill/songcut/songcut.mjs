#!/usr/bin/env node
/**
 * songcut — 말하는 영상의 공백을 잘라 내고, 쇼츠(9:16)로 바꾸고, 한글 자막을 입히는 작은 도우미.
 *
 *   node songcut.mjs doctor                         ffmpeg · ffprobe · 한글 폰트가 있는지 본다
 *   node songcut.mjs cut <영상> [--db -35] [--min 0.4] [--pad 0.12] [--out 파일]
 *                                                   공백(무음) 구간을 찾아 잘라 낸다 → <이름>_cut.mp4 + <이름>_cut.json
 *   node songcut.mjs shorts <영상> [--title 글] [--title-sec 3] [--hook 초] [--srt 자막.srt] [--out 파일]
 *                                                   1080x1920 쇼츠로 바꾼다(흐린 배경 + 가운데 원본) → <이름>_shorts.mp4
 *   node songcut.mjs info <영상>                     길이·해상도·소리 유무를 본다
 *
 * ★네트워크를 쓰지 않는다. 영상은 내 컴퓨터 밖으로 나가지 않는다.
 * ★명령의 exit 0 을 믿지 않는다 — 만들어진 파일의 길이를 ffprobe 로 다시 재서 맞을 때만 「끝」이라고 말한다.
 * ★자막을 자동으로 받아 적지 않는다(음성 인식 없음). 자막은 .srt 로 직접 주거나 다른 도구로 만든다.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const 돌려 = (명령, 인자, 옵션 = {}) => spawnSync(명령, 인자, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...옵션 });
const 있나 = (명령) => { try { return 돌려(명령, ["-version"]).status === 0; } catch { return false; } };
const 초 = (n) => Number(n.toFixed(3));

/* 한글 폰트 — libass(자막)는 글꼴 이름으로, drawtext(제목)는 파일 경로로 찾는다. */
const 알려진폰트 = [
  ["C:\\Windows\\Fonts\\malgunbd.ttf", "Malgun Gothic"],
  ["C:\\Windows\\Fonts\\malgun.ttf", "Malgun Gothic"],
  ["/System/Library/Fonts/AppleSDGothicNeo.ttc", "Apple SD Gothic Neo"],
  ["/Library/Fonts/NanumGothicBold.ttf", "NanumGothic"],
  ["/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf", "NanumGothic"],
  ["/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "Noto Sans CJK KR"],
  ["/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc", "Noto Sans CJK KR"],
];
export function 한글폰트() {
  for (const [파일, 이름] of 알려진폰트) if (existsSync(파일)) return { 파일, 이름 };
  const r = platform() === "win32" ? null : 돌려("fc-list", [":lang=ko", "file", "family"]);
  const 줄 = r && r.status === 0 ? r.stdout.split("\n").filter(Boolean) : [];
  const 좋은 = 줄.find((l) => /Nanum|Noto Sans CJK|Malgun|Gothic/i.test(l)) || 줄[0];
  if (!좋은) return null;
  const [파일, 이름] = 좋은.split(":").map((s) => s.trim());
  return { 파일, 이름: (이름 || "").split(",")[0] || "sans-serif" };
}

export function 점검() {
  return { ffmpeg: 있나("ffmpeg"), ffprobe: 있나("ffprobe"), 폰트: 한글폰트() };
}

export function 정보(영상) {
  const r = 돌려("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", 영상]);
  if (r.status !== 0) throw new Error(`영상을 읽지 못했다 — ${r.stderr.trim()}`);
  const j = JSON.parse(r.stdout), 화면 = j.streams.find((s) => s.codec_type === "video");
  return { 길이: Number(j.format.duration), 가로: 화면?.width || 0, 세로: 화면?.height || 0, 소리: j.streams.some((s) => s.codec_type === "audio") };
}

/* 공백 찾기 — ffmpeg silencedetect 의 출력을 읽어 [시작, 끝] 무음 구간 목록을 만든다. */
export function 무음찾기(영상, { db = -35, min = 0.4 } = {}) {
  const r = 돌려("ffmpeg", ["-hide_banner", "-nostats", "-i", 영상, "-vn", "-af", `silencedetect=noise=${db}dB:d=${min}`, "-f", "null", "-"]);
  if (r.status !== 0) throw new Error(`공백을 찾지 못했다 — ${r.stderr.split("\n").slice(-3).join(" ")}`);
  const 구간 = [];
  let 시작 = null;
  for (const l of r.stderr.split("\n")) {
    const s = l.match(/silence_start: (-?[\d.]+)/), e = l.match(/silence_end: ([\d.]+)/);
    if (s) 시작 = Math.max(0, Number(s[1]));
    if (e && 시작 !== null) { 구간.push([시작, Number(e[1])]); 시작 = null; }
  }
  if (시작 !== null) 구간.push([시작, Infinity]);
  return 구간;
}

/* 남길 구간 — 무음의 반대. 말 앞뒤로 pad 초씩 여유를 두고, 너무 짧은 조각(0.1초 미만)은 버린다. */
export function 남길구간(무음, 길이, pad = 0.12) {
  const 남김 = [];
  let 앞 = 0;
  for (const [s, e] of 무음) {
    const 끝 = Math.min(길이, s + pad);
    if (끝 - 앞 > 0.1) 남김.push([앞, 끝]);
    앞 = Math.max(앞, Math.min(길이, e - pad));
  }
  if (길이 - 앞 > 0.1) 남김.push([앞, 길이]);
  return 남김.map(([a, b]) => [초(a), 초(b)]);
}

const 이름짓기 = (영상, 꼬리, 지정) => 지정 ? resolve(지정) : join(dirname(resolve(영상)), basename(영상, extname(영상)) + 꼬리);

function 결과확인(파일, 기대길이, 무엇) {
  if (!existsSync(파일) || statSync(파일).size < 1000) throw new Error(`${무엇} 파일이 만들어지지 않았다 — ${파일}`);
  const 실제 = 정보(파일).길이;
  if (Math.abs(실제 - 기대길이) > Math.max(0.5, 기대길이 * 0.03)) throw new Error(`${무엇} 길이가 어긋났다 — 기대 ${기대길이.toFixed(2)}초, 실제 ${실제.toFixed(2)}초`);
  return 실제;
}

export function 자르기(영상, { db = -35, min = 0.4, pad = 0.12, out } = {}) {
  const 원 = 정보(영상);
  if (!원.소리) throw new Error("소리가 없는 영상이다 — 공백을 소리로 찾기 때문에 자를 수 없다");
  const 남김 = 남길구간(무음찾기(영상, { db, min }), 원.길이, pad);
  if (!남김.length) throw new Error("남길 구간이 없다 — --db 를 더 낮게(예: -45) 해 본다");
  const 새길이 = 남김.reduce((n, [a, b]) => n + (b - a), 0);
  const 끝파일 = 이름짓기(영상, "_cut.mp4", out);
  const 식 = 남김.map(([a, b]) => `between(t,${a},${b})`).join("+");
  const 임시 = mkdtempSync(join(tmpdir(), "songcut-"));
  try {
    const 그래프 = join(임시, "graph.txt");
    writeFileSync(그래프, `[0:v]select='${식}',setpts=N/FRAME_RATE/TB[v];[0:a]aselect='${식}',asetpts=N/SR/TB[a]`);
    const r = 돌려("ffmpeg", ["-y", "-v", "error", "-i", 영상, "-filter_complex_script", 그래프, "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", 끝파일]);
    if (r.status !== 0) throw new Error(`자르지 못했다 — ${r.stderr.trim()}`);
  } finally { rmSync(임시, { recursive: true, force: true }); }
  const 실제 = 결과확인(끝파일, 새길이, "자른 영상");
  const 보고 = { 원본: resolve(영상), 결과: 끝파일, 원래길이: 초(원.길이), 새길이: 초(실제), 줄어든초: 초(원.길이 - 실제), 줄어든비율: Math.round((1 - 실제 / 원.길이) * 100), 남긴조각: 남김.length, 설정: { db, min, pad }, 남긴구간: 남김 };
  writeFileSync(끝파일.replace(/\.mp4$/i, ".json"), JSON.stringify(보고, null, 2));
  return 보고;
}

export function 쇼츠(영상, { title, titleSec = 3, hook, srt, out } = {}) {
  const 원 = 정보(영상), 폰트 = 한글폰트();
  if ((title || srt) && !폰트) throw new Error("한글 폰트를 찾지 못했다 — 글자가 □ 로 깨진다. 나눔고딕 등을 깔고 다시 한다(doctor 로 확인)");
  const 끝파일 = 이름짓기(영상, "_shorts.mp4", out);
  const 임시 = mkdtempSync(join(tmpdir(), "songcut-"));
  try {
    const 입력 = ["-i", resolve(영상)];
    const 줄 = [];
    let v = "[0:v]", a = 원.소리 ? "[0:a]" : null, 길이 = 원.길이;
    /* 후킹 — 지정한 초부터 3초를 맨 앞에 한 번 더 붙인다(알고리즘이 좋아하는 「첫 3초」). */
    if (hook !== undefined) {
      const h = Math.max(0, Math.min(Number(hook), 원.길이 - 0.5)), he = Math.min(원.길이, h + 3);
      줄.push(`[0:v]split[v1][v2]`, `[v1]trim=${h}:${he},setpts=PTS-STARTPTS[hv]`, `[v2]setpts=PTS-STARTPTS[mv]`);
      if (a) 줄.push(`[0:a]asplit[a1][a2]`, `[a1]atrim=${h}:${he},asetpts=PTS-STARTPTS[ha]`, `[a2]asetpts=PTS-STARTPTS[ma]`,
        `[hv][ha][mv][ma]concat=n=2:v=1:a=1[jv][ja]`);
      else 줄.push(`[hv][mv]concat=n=2:v=1:a=0[jv]`);
      v = "[jv]"; if (a) a = "[ja]"; 길이 += he - h;
    }
    줄.push(`${v}split[bg0][fg0]`,
      `[bg0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2,eq=brightness=-0.08[bg]`,
      `[fg0]scale=1080:-2[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[s0]`);
    let 마지막 = "[s0]";
    if (title) {
      writeFileSync(join(임시, "title.txt"), title);
      copyFileSync(폰트.파일, join(임시, "font" + extname(폰트.파일)));
      줄.push(`${마지막}drawtext=fontfile='font${extname(폰트.파일)}':textfile='title.txt':fontsize=78:fontcolor=white:borderw=6:bordercolor=black@0.85:x=(w-text_w)/2:y=260:line_spacing=18:enable='lt(t,${titleSec})'[s1]`);
      마지막 = "[s1]";
    }
    if (srt) {
      copyFileSync(resolve(srt), join(임시, "sub.srt"));
      줄.push(`${마지막}subtitles=sub.srt:force_style='FontName=${폰트.이름},FontSize=12,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginL=8,MarginR=8,MarginV=60'[s2]`);
      마지막 = "[s2]";
    }
    writeFileSync(join(임시, "graph.txt"), 줄.join(";"));
    const 지도 = ["-map", 마지막, ...(a ? ["-map", a] : [])];
    const r = 돌려("ffmpeg", ["-y", "-v", "error", ...입력, "-filter_complex_script", "graph.txt", ...지도,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", ...(a ? ["-c:a", "aac", "-b:a", "160k"] : []), "-movflags", "+faststart", 끝파일], { cwd: 임시 });
    if (r.status !== 0) throw new Error(`쇼츠를 만들지 못했다 — ${r.stderr.trim()}`);
    const 실제 = 결과확인(끝파일, 길이, "쇼츠");
    const 크기 = 정보(끝파일);
    if (크기.가로 !== 1080 || 크기.세로 !== 1920) throw new Error(`화면 크기가 어긋났다 — ${크기.가로}x${크기.세로}`);
    return { 결과: 끝파일, 길이: 초(실제), 화면: "1080x1920", 제목: !!title, 후킹: hook !== undefined, 자막: !!srt, 폰트: 폰트?.이름 || null };
  } finally { rmSync(임시, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const 인자 = process.argv.slice(2), [명, 영상] = 인자;
  const 값 = (k, 기본) => { const i = 인자.indexOf(k); return i >= 0 && 인자[i + 1] !== undefined ? 인자[i + 1] : 기본; };
  const 수 = (k, 기본) => { const v = Number(값(k, 기본)); if (!Number.isFinite(v)) throw new Error(`${k} 값이 숫자가 아니다`); return v; };
  try {
    if (명 === "doctor") {
      const r = 점검();
      console.log(`ffmpeg ${r.ffmpeg ? "있음" : "없음"} · ffprobe ${r.ffprobe ? "있음" : "없음"} · 한글 폰트 ${r.폰트 ? r.폰트.이름 + " (" + r.폰트.파일 + ")" : "없음 — 제목·자막이 깨진다"}`);
      process.exitCode = r.ffmpeg && r.ffprobe ? 0 : 1;
    } else if (명 === "info" && 영상) {
      const r = 정보(영상);
      console.log(`길이 ${r.길이.toFixed(2)}초 · ${r.가로}x${r.세로} · 소리 ${r.소리 ? "있음" : "없음"}`);
    } else if (명 === "cut" && 영상) {
      const r = 자르기(영상, { db: 수("--db", -35), min: 수("--min", 0.4), pad: 수("--pad", 0.12), out: 값("--out") });
      console.log(`끝 — ${r.결과}\n  ${r.원래길이}초 → ${r.새길이}초 (${r.줄어든초}초 · ${r.줄어든비율}% 줄임) · 남긴 조각 ${r.남긴조각}개\n  구간 기록 — ${r.결과.replace(/\.mp4$/i, ".json")}`);
    } else if (명 === "shorts" && 영상) {
      const r = 쇼츠(영상, { title: 값("--title"), titleSec: 수("--title-sec", 3), hook: 값("--hook") === undefined ? undefined : 수("--hook", 0), srt: 값("--srt"), out: 값("--out") });
      console.log(`끝 — ${r.결과}\n  ${r.화면} · ${r.길이}초 · 제목 ${r.제목 ? "있음" : "없음"} · 첫 3초 후킹 ${r.후킹 ? "있음" : "없음"} · 자막 ${r.자막 ? "있음" : "없음"}${r.폰트 ? " · 폰트 " + r.폰트 : ""}`);
    } else {
      console.log("쓰는 법: node songcut.mjs doctor | info <영상> | cut <영상> [--db -35 --min 0.4 --pad 0.12] | shorts <영상> [--title 글 --hook 초 --srt 자막.srt]");
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
