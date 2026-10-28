#!/usr/bin/env node
/**
 * songcut 설치기 — 공백 0초 컷편집 스킬(songcut)을 클로드 코드 스킬 폴더에 놓는다.
 *
 *   npx --yes creimeta-songcut              스킬 놓기 + 시험
 *   npx --yes creimeta-songcut --check      깔지 않고 이미 놓였는지·도는지만 본다
 *   npx --yes creimeta-songcut --dry-run    어디로 갈지 보여 주기만 한다
 *   npx --yes creimeta-songcut --local      현재 폴더(.claude/skills)에 놓는다
 *   npx --yes creimeta-songcut --force      이미 있어도 덮어쓴다
 *   npx --yes creimeta-songcut --self-test  자기시험 (ffmpeg 가 있으면 진짜 영상을 만들어 잘라 본다)
 *
 * ★네트워크를 쓰지 않는다 — 스킬이 패키지 안에 들어 있다.
 * ★이미 있으면 덮지 않는다(--force 로만). 사용자의 CLAUDE.md 는 건드리지 않는다.
 * ★놓기 전·후로 파일을 세어 늘었을 때만 「놓였다」고 말한다.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { 남길구간, 자르기, 점검 } from "./skill/songcut/songcut.mjs";
import { 안내 } from "./brand.mjs";

const CFG = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const 원본 = join(dirname(fileURLToPath(import.meta.url)), "skill", "songcut");
const 인자 = process.argv.slice(2);
const 켜짐 = (k) => 인자.includes(k);
const c = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[90m", cy: "\x1b[36m", b: "\x1b[1m", 0: "\x1b[0m" };
const 스킬방 = () => (켜짐("--local") ? resolve(process.cwd(), ".claude", "skills") : join(CFG, "skills"));

function 파일수(p) {
  if (!existsSync(p)) return 0;
  let n = 0;
  const 걷기 = (d) => { for (const f of readdirSync(d)) { const q = join(d, f); if (statSync(q).isDirectory()) 걷기(q); else n++; } };
  걷기(p);
  return n;
}

/* 시험 — 계산은 늘 본다. ffmpeg 가 있으면 소리-공백-소리 영상을 임시로 만들어 실제로 자르고 길이를 잰다. */
function 시험() {
  const 계산 = JSON.stringify(남길구간([[2, 4], [6, 8.5]], 12, 0.12)) === JSON.stringify([[0, 2.12], [3.88, 6.12], [8.38, 12]]);
  const 렌 = 점검();
  if (!렌.ffmpeg || !렌.ffprobe) return { 계산, 실제자르기: null };
  const 임시 = mkdtempSync(join(tmpdir(), "songcut-test-"));
  try {
    const 영상 = join(임시, "talk.mp4");
    const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x2d5f9a:s=640x360:r=30:d=12", "-f", "lavfi", "-i", "sine=frequency=440:duration=12",
      "-af", "volume=0:enable='between(t,2,4)+between(t,6,8.5)'", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", 영상], { encoding: "utf8" });
    if (r.status !== 0) return { 계산, 실제자르기: false };
    const 보고 = 자르기(영상);
    return { 계산, 실제자르기: 보고.새길이 > 7.6 && 보고.새길이 < 8.4 && 보고.남긴조각 === 3, 보고 };
  } catch { return { 계산, 실제자르기: false }; } finally { rmSync(임시, { recursive: true, force: true }); }
}

function 자기시험() {
  const 진 = [];
  const 본다 = (이름, 참, 값 = "") => { console.log(`  ${참 ? c.g + "✓" : c.r + "✗"}${c[0]} ${이름} ${c.d}${값}${c[0]}`); if (!참) 진.push(이름); };
  console.log(`${c.b}songcut 자기시험${c[0]}`);
  const t = 시험();
  본다("남길 구간 계산이 맞다 (공백 2곳 → 조각 3개)", t.계산);
  if (t.실제자르기 === null) console.log(`  ${c.y}!${c[0]} ffmpeg 가 없어 실제 자르기는 건너뛰었다`);
  else 본다("12초 영상의 공백 4.5초를 실제로 잘랐다", t.실제자르기, t.보고 ? `${t.보고.원래길이}초 → ${t.보고.새길이}초` : "");
  본다("스킬 원본 파일이 패키지에 있다", existsSync(join(원본, "SKILL.md")) && existsSync(join(원본, "songcut.mjs")));
  process.exitCode = 진.length ? 1 : 0;
  console.log(진.length ? `${c.r}실패 ${진.length}건${c[0]}` : `${c.g}통과${c[0]}`);
}

function 메인() {
  if (켜짐("--self-test")) return 자기시험();
  const 자리 = join(스킬방(), "songcut");
  console.log(`${c.b}songcut${c[0]} ${c.d}공백 0초 컷편집 + 쇼츠 변환${c[0]}`);
  const 렌 = 점검();
  const 준비 = `ffmpeg ${렌.ffmpeg ? "있음" : "없음"} · 한글 폰트 ${렌.폰트 ? 렌.폰트.이름 : "없음"}`;

  if (켜짐("--check")) {
    const 놓임 = existsSync(join(자리, "SKILL.md")) && existsSync(join(자리, "songcut.mjs"));
    console.log(놓임 ? `  ${c.g}✓${c[0]} 스킬이 놓여 있다 (${자리} · 파일 ${파일수(자리)}개)` : `  ${c.y}!${c[0]} 아직 안 놓였다 — npx --yes creimeta-songcut`);
    console.log(`  ${렌.ffmpeg && 렌.폰트 ? c.g + "✓" : c.y + "!"}${c[0]} 편집 준비 — ${준비}`);
    process.exitCode = 놓임 ? 0 : 1;
    return;
  }
  if (켜짐("--dry-run")) { console.log(`  ${c.d}원본 ${원본}\n  자리 ${자리}\n  (아무것도 놓지 않았다)${c[0]}`); return; }
  if (existsSync(자리) && !켜짐("--force")) { console.log(`  ${c.y}!${c[0]} 이미 ${자리} 가 있다 — 덮지 않았다. 덮으려면 --force`); return; }

  const 전 = 파일수(자리);
  try {
    if (existsSync(자리)) rmSync(자리, { recursive: true, force: true });
    mkdirSync(dirname(자리), { recursive: true });
    cpSync(원본, 자리, { recursive: true });
  } catch (e) { console.error(`${c.r}놓지 못했다 — ${e.message}${c[0]}`); process.exitCode = 1; return; }
  const 후 = 파일수(자리);
  if (후 === 0 || !existsSync(join(자리, "SKILL.md"))) { console.error(`${c.r}파일이 놓이지 않았다(${전} → ${후}) — 놓였다고 말하지 않는다.${c[0]}`); process.exitCode = 1; return; }
  console.log(`  ${c.g}✓${c[0]} 스킬을 놓았다 — ${자리} (파일 ${후}개)`);

  const t = 시험();
  if (!t.계산 || t.실제자르기 === false) { console.error(`  ${c.r}✗${c[0]} 시험이 어긋났다 — 계산 ${t.계산} · 자르기 ${t.실제자르기}`); process.exitCode = 1; return; }
  console.log(t.실제자르기 ? `  ${c.g}✓${c[0]} 임시 영상의 공백을 실제로 잘라 길이를 다시 쟀다 (${t.보고.원래길이}초 → ${t.보고.새길이}초)` : `  ${c.y}!${c[0]} 계산은 맞다. ffmpeg 가 없어 실제 자르기는 못 해 봤다 — https://ffmpeg.org 에서 받는다`);
  console.log(`  ${렌.ffmpeg && 렌.폰트 ? c.g + "✓" : c.y + "!"}${c[0]} 편집 준비 — ${준비}`);
  console.log(`\n  ${c.d}클로드 코드를 한 번 다시 켠 뒤:  쏭컷으로 강의.mp4 공백 잘라 줘${c[0]}`);
  console.log(`\n  ${c.b}${안내.제목}${c[0]} — ${안내.한줄}\n  ${c.cy}${안내.링크}${c[0]}`);
}

메인();
