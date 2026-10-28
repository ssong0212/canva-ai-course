/* 쏭컷 추억 영상 — 사진·동영상을 날짜순으로 놓고, 동영상은 소리가 가장 활발한 구간을 고르고,
 * 밝기·색을 자동으로 맞춰 제목·자막·음악과 함께 영상 한 편으로 만든다. 모두 브라우저 안에서만 한다. */
(() => {
  const $ = (id) => document.getElementById(id);
  const 폰트 = '"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  const 페이드 = 0.4, 카드초 = 2.8;
  const view = $("view"), ctx = view.getContext("2d"), vid = $("vid"), bgm = $("bgm");
  const 배경 = document.createElement("canvas"), 배경ctx = 배경.getContext("2d");
  const 상태 = { 항목: [], 재생중: false, 멈춤요청: false };
  let 오디오, 영상소리, 음악소리, 녹음목적지;

  const 시각 = (s) => { const m = Math.floor(s / 60); return `${m}:${String(Math.round(s - m * 60)).padStart(2, "0")}`; };
  const 날짜글 = (d) => `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, "0")}. ${String(d.getDate()).padStart(2, "0")}`;
  const 기다려 = (el, ev) => new Promise((ok, no) => { el.addEventListener(ev, ok, { once: true }); el.addEventListener("error", () => no(new Error("파일을 열지 못했습니다")), { once: true }); });
  const 쉼 = () => new Promise((ok) => requestAnimationFrame(ok));
  const 설정 = () => ({ 사진초: +$("photoSec").value, 영상초: +$("clipSec").value });

  /* ── 1. 파일 넣기 ─────────────────────────────── */
  const drop = $("drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); 넣기([...e.dataTransfer.files]); });
  $("files").addEventListener("change", (e) => { 넣기([...e.target.files]); e.target.value = ""; });
  $("addMore").addEventListener("click", () => $("files").click());

  async function 넣기(파일들) {
    파일들 = 파일들.filter((f) => /^(image|video)\//.test(f.type) || /\.(heic|mov)$/i.test(f.name));
    if (!파일들.length) return;
    오디오준비();
    drop.querySelector("h3").textContent = `${파일들.length}개를 살펴보는 중…`;
    const 못연것 = [];
    for (const f of 파일들) {
      try { 상태.항목.push(f.type.startsWith("video/") || /\.mov$/i.test(f.name) ? await 동영상읽기(f) : await 사진읽기(f)); }
      catch { 못연것.push(f.name); }
    }
    if (못연것.length) alert(`열지 못한 파일 ${못연것.length}개: ${못연것.slice(0, 5).join(", ")}\n아이폰 HEIC 사진은 사진 앱에서 '호환성 우선'으로 바꾸거나 jpg로 보내 주세요.`);
    상태.항목.sort((a, b) => a.날짜 - b.날짜);
    await document.fonts.load(`900 72px ${폰트}`).catch(() => {});
    drop.classList.add("hidden"); $("work").classList.remove("hidden"); $("export").disabled = !상태.항목.length;
    화면크기(); 목록(); 표지그리기();
  }

  async function 사진읽기(f) {
    const url = URL.createObjectURL(f), img = new Image();
    img.src = url; await img.decode();
    return { 종류: "사진", 파일: f, url, el: img, 날짜: new Date(f.lastModified), 글: "", 보정: 밝기재기(img, img.naturalWidth, img.naturalHeight) };
  }

  async function 동영상읽기(f) {
    const url = URL.createObjectURL(f), v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.src = url;
    await 기다려(v, "loadedmetadata");
    const 항목 = { 종류: "동영상", 파일: f, url, 날짜: new Date(f.lastModified), 글: "", 원길이: v.duration, 시작: 0, 보정: null };
    항목.시작 = await 하이라이트(f, v.duration);
    v.currentTime = Math.min(v.duration - 0.05, 항목.시작 + 0.3);
    await 기다려(v, "seeked");
    항목.보정 = 밝기재기(v, v.videoWidth, v.videoHeight);
    항목.썸네일 = 작은그림(v, v.videoWidth, v.videoHeight);
    v.removeAttribute("src"); v.load();
    return 항목;
  }

  /* 하이라이트 — 0.1초마다 소리 크기를 재고, 「동영상 한 개」 길이 동안 소리가 가장 큰 구간을 고른다(웃음·환호·말소리) */
  async function 하이라이트(f, 길이) {
    const 칸길이 = 설정().영상초;
    if (길이 <= 칸길이 || f.size > 400 * 1048576) return Math.max(0, (길이 - 칸길이) / 2);
    try {
      const buf = await 오디오.decodeAudioData(await f.arrayBuffer()), d = buf.getChannelData(0), 칸 = Math.floor(buf.sampleRate / 10);
      const 크기 = [];
      for (let i = 0; i + 칸 <= d.length; i += 칸) { let s = 0; for (let k = i; k < i + 칸; k += 4) s += d[k] * d[k]; 크기.push(s); }
      const 폭 = Math.round(칸길이 * 10);
      let 합 = 0, 최고 = -1, 자리 = 0;
      for (let i = 0; i < 크기.length; i++) { 합 += 크기[i]; if (i >= 폭) 합 -= 크기[i - 폭]; if (i >= 폭 - 1 && 합 > 최고) { 최고 = 합; 자리 = i - 폭 + 1; } }
      return Math.min(자리 / 10, 길이 - 칸길이);
    } catch { return Math.max(0, (길이 - 칸길이) / 2); }
  }

  /* 자동 보정 — 48×48 로 줄여 평균 밝기·채도를 재고, 목표에 맞게 밝기·대비·채도 배율을 정한다 */
  function 밝기재기(src, w, h) {
    const c = document.createElement("canvas"); c.width = c.height = 48;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(src, 0, 0, w, h, 0, 0, 48, 48);
    const p = x.getImageData(0, 0, 48, 48).data;
    let L = 0, S = 0;
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i] / 255, g = p[i + 1] / 255, b = p[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      L += 0.2126 * r + 0.7152 * g + 0.0722 * b; S += mx ? (mx - mn) / mx : 0;
    }
    L /= p.length / 4; S /= p.length / 4;
    return { 밝기: Math.min(1.7, Math.max(0.88, 0.5 / Math.max(L, 0.05))), 대비: L < 0.35 ? 1.12 : 1.05, 채도: S < 0.25 ? 1.2 : 1.05 };
  }
  function 작은그림(src, w, h) {
    const c = document.createElement("canvas"); c.width = 160; c.height = Math.round(160 * h / w) || 90;
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.7);
  }
  function 필터(항목) {
    const 느낌 = $("look").value;
    if (느낌 === "none") return "none";
    const b = $("autoFix").checked && 항목.보정 ? 항목.보정 : { 밝기: 1, 대비: 1, 채도: 1 };
    const 더 = { natural: "", warm: " sepia(0.18) saturate(1.1)", vivid: " contrast(1.1) saturate(1.2)", film: " sepia(0.25) contrast(0.92) saturate(0.85)", mono: " grayscale(1) contrast(1.12)" }[느낌];
    return `brightness(${b.밝기.toFixed(2)}) contrast(${b.대비.toFixed(2)}) saturate(${b.채도.toFixed(2)})${더}`;
  }

  /* ── 2. 순서 목록 ─────────────────────────────── */
  function 길이(항목) { const s = 설정(); return 항목.종류 === "사진" ? s.사진초 : Math.min(s.영상초, 항목.원길이 - 항목.시작); }
  function 순서() {
    const 칸 = [];
    if ($("title").value.trim()) 칸.push({ 종류: "제목", 길이: 카드초 });
    상태.항목.forEach((h, i) => 칸.push({ 종류: h.종류, 항목: h, 번호: i, 길이: 길이(h) }));
    if ($("ending").value.trim()) 칸.push({ 종류: "끝", 길이: 카드초 });
    return 칸;
  }
  function 총길이() { return 순서().reduce((n, c) => n + c.길이, 0); }
  function 목록() {
    const ol = $("list"); ol.innerHTML = "";
    상태.항목.forEach((h, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<img alt=""><div class="meta"><b></b><span class="muted"></span><input type="text" maxlength="40" placeholder="자막 (비워 두면 없음)"></div><div class="ctl"><button title="앞으로">↑</button><button title="뒤로">↓</button><button title="빼기">✕</button></div>`;
      li.querySelector("img").src = h.종류 === "사진" ? h.url : h.썸네일;
      li.querySelector("b").textContent = `${i + 1}. ${h.종류}`;
      const 설명 = li.querySelector("span");
      설명.textContent = ` ${날짜글(h.날짜)} · ${길이(h).toFixed(1)}초`;
      if (h.종류 === "동영상") {
        const 시작 = document.createElement("label");
        시작.className = "muted"; 시작.style.fontSize = "13px";
        시작.innerHTML = `시작 <input type="number" min="0" step="0.5" style="width:70px">초 (전체 ${h.원길이.toFixed(1)}초)`;
        const n = 시작.querySelector("input"); n.value = h.시작.toFixed(1); n.max = Math.max(0, h.원길이 - 1);
        n.addEventListener("change", () => { h.시작 = Math.min(Math.max(0, +n.value || 0), Math.max(0, h.원길이 - 1)); 목록(); });
        li.querySelector(".meta").appendChild(시작);
      }
      const 글 = li.querySelector("input[type=text]"); 글.value = h.글;
      글.addEventListener("input", () => (h.글 = 글.value));
      const [위, 아래, 빼] = li.querySelectorAll(".ctl button");
      위.onclick = () => { if (i) { [상태.항목[i - 1], 상태.항목[i]] = [상태.항목[i], 상태.항목[i - 1]]; 목록(); } };
      아래.onclick = () => { if (i < 상태.항목.length - 1) { [상태.항목[i + 1], 상태.항목[i]] = [상태.항목[i], 상태.항목[i + 1]]; 목록(); } };
      빼.onclick = () => { 상태.항목.splice(i, 1); 목록(); $("export").disabled = !상태.항목.length; };
      ol.appendChild(li);
    });
    $("total").textContent = `${상태.항목.length}개 · 약 ${시각(총길이())}`;
  }
  ["photoSec", "clipSec"].forEach((id) => $(id).addEventListener("input", () => { $("photoSecV").textContent = `${$("photoSec").value}초`; $("clipSecV").textContent = `${$("clipSec").value}초`; 상태.항목.length && 목록(); }));
  ["title", "ending"].forEach((id) => $(id).addEventListener("input", () => { 상태.항목.length && 목록(); 표지그리기(); }));
  ["look", "autoFix", "dateStamp"].forEach((id) => $(id).addEventListener("change", 표지그리기));
  $("layout").addEventListener("change", () => { 화면크기(); 표지그리기(); });

  /* ── 3. 그리기 ─────────────────────────────── */
  function 화면크기() {
    const [w, h] = { shorts: [1080, 1920], wide: [1920, 1080], square: [1080, 1080] }[$("layout").value];
    view.width = w; view.height = h;
  }
  function 줄나누기(글, 폭) {
    const 줄 = [];
    for (const 문단 of String(글).split("\n")) {
      let 지금 = "";
      for (const 낱 of 문단.split(/(\s+)/)) {
        if (ctx.measureText(지금 + 낱).width <= 폭) { 지금 += 낱; continue; }
        if (지금.trim()) 줄.push(지금.trim());
        지금 = "";
        for (const 자 of 낱.trimStart()) { if (ctx.measureText(지금 + 자).width > 폭 && 지금) { 줄.push(지금); 지금 = ""; } 지금 += 자; }
      }
      if (지금.trim()) 줄.push(지금.trim());
    }
    return 줄;
  }
  function 글자(글, y, 크기, { 아래부터 = false, 굵기 = 900, 테두리 = true } = {}) {
    ctx.font = `${굵기} ${크기}px ${폰트}`; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.lineJoin = "round";
    const 줄 = 줄나누기(글, view.width * 0.86), 높이 = 크기 * 1.32, 시작 = 아래부터 ? y - 줄.length * 높이 : y;
    줄.forEach((l, i) => {
      if (테두리) { ctx.lineWidth = 크기 * 0.16; ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.strokeText(l, view.width / 2, 시작 + i * 높이); }
      ctx.fillStyle = "#fff"; ctx.fillText(l, view.width / 2, 시작 + i * 높이);
    });
  }
  const 기준 = () => Math.min(view.width, view.height) / 1080;

  /* 사진·동영상 한 장면 — 흐린 배경 + 가운데 맞춤 + (사진은) 천천히 다가가는 움직임 */
  function 장면(src, sw, sh, 항목, p, 번호) {
    const W = view.width, H = view.height;
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    const f = 필터(항목);
    /* 흐린 배경 — 1/12 크기로 줄여 흐리게 한 뒤 늘려 붙인다(전체 크기로 흐리는 것보다 훨씬 가볍다) */
    const bw = 배경.width = Math.ceil(W / 12), bh = 배경.height = Math.ceil(H / 12), 덮 = Math.max(bw / sw, bh / sh);
    배경ctx.filter = (f === "none" ? "" : f + " ") + "blur(3px) brightness(0.75)";
    배경ctx.drawImage(src, (bw - sw * 덮) / 2, (bh - sh * 덮) / 2, sw * 덮, sh * 덮);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(배경, 0, 0, bw, bh, -W * 0.05, -H * 0.05, W * 1.1, H * 1.1);
    ctx.filter = f;
    let 맞 = Math.min(W / sw, H / sh);
    if (Math.abs(W / H - sw / sh) < 0.25) 맞 = Math.max(W / sw, H / sh);   // 비율이 비슷하면 꽉 채운다
    const 줌 = 항목.종류 === "사진" ? 1 + 0.08 * (번호 % 2 ? 1 - p : p) : 1;
    const 이동 = 항목.종류 === "사진" ? (번호 % 2 ? -1 : 1) * 0.02 * W * (p - 0.5) : 0;
    const dw = sw * 맞 * 줌, dh = sh * 맞 * 줌;
    ctx.drawImage(src, (W - dw) / 2 + 이동, (H - dh) / 2, dw, dh);
    ctx.filter = "none";
    const k = 기준();
    if ($("dateStamp").checked && 항목.종류 === "사진") {
      ctx.font = `700 ${34 * k}px ${폰트}`; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
      ctx.fillStyle = "rgba(255,190,90,.95)"; ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 6;
      ctx.fillText(날짜글(항목.날짜), W - 40 * k, H - (H > W ? 150 : 40) * k);
      ctx.shadowBlur = 0;
    }
    if (항목.글) 글자(항목.글, H * (H > W ? 0.8 : 0.9), 64 * k, { 아래부터: true });
  }
  function 카드(글, 작은글) {
    const W = view.width, H = view.height, g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#ff8a7a"); g.addColorStop(1, "#ffc56b");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const k = 기준();
    ctx.font = `900 ${96 * k}px ${폰트}`;
    const 줄수 = 줄나누기(글, W * 0.86).length;
    글자(글, H / 2 - (줄수 * 96 * 1.32 * k) / 2 - 20 * k, 96 * k, { 테두리: false });
    if (작은글) 글자(작은글, H / 2 + (줄수 * 96 * 1.32 * k) / 2 + 10 * k, 40 * k, { 굵기: 700, 테두리: false });
  }
  function 날짜범위() {
    if (!상태.항목.length) return "";
    const ds = 상태.항목.map((h) => h.날짜.getTime()), a = new Date(Math.min(...ds)), b = new Date(Math.max(...ds));
    return 날짜글(a) === 날짜글(b) ? 날짜글(a) : `${날짜글(a)} – ${날짜글(b)}`;
  }
  function 표지그리기() {
    if (상태.재생중 || !상태.항목.length) return;
    const t = $("title").value.trim(), 첫 = 상태.항목[0];
    if (t) 카드(t, 날짜범위());
    else if (첫.종류 === "사진") 장면(첫.el, 첫.el.naturalWidth, 첫.el.naturalHeight, 첫, 0, 0);
    else { const img = new Image(); img.onload = () => 장면(img, img.width, img.height, 첫, 0, 0); img.src = 첫.썸네일; }
  }
  function 어둡게(남은, 지난) { const a = Math.max(0, 1 - Math.min(지난, 남은) / 페이드); if (a > 0) { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(0, 0, view.width, view.height); } }

  /* ── 4. 재생 엔진(미리보기와 내보내기가 같은 길을 쓴다) ───── */
  function 오디오준비() {
    if (오디오) return;
    오디오 = new AudioContext();
    녹음목적지 = 오디오.createMediaStreamDestination();
    영상소리 = 오디오.createGain(); 음악소리 = 오디오.createGain();
    오디오.createMediaElementSource(vid).connect(영상소리);
    오디오.createMediaElementSource(bgm).connect(음악소리);
    for (const g of [영상소리, 음악소리]) { g.connect(오디오.destination); g.connect(녹음목적지); }
  }
  $("music").addEventListener("change", (e) => { if (e.target.files[0]) { bgm.src = URL.createObjectURL(e.target.files[0]); bgm.loop = true; } });
  $("musicVol").addEventListener("input", () => ($("musicVolV").textContent = `${Math.round($("musicVol").value * 100)}%`));
  const 음악크기 = (줄임) => 음악소리.gain.setTargetAtTime(+$("musicVol").value * (줄임 ? 0.3 : 1), 오디오.currentTime, 0.15);

  async function 재생(녹) {
    const 칸들 = 순서(), 총 = 칸들.reduce((n, c) => n + c.길이, 0);
    상태.재생중 = true; 상태.멈춤요청 = false;
    await 오디오.resume();
    영상소리.gain.value = $("origSound").checked ? 1 : 0;
    if (bgm.src) { bgm.currentTime = 0; 음악크기(false); }
    let 지난총 = 0;
    const 잠깐 = () => { 녹?.state === "recording" && 녹.pause(); bgm.pause(); };
    const 이어 = () => { 녹 && (녹.state === "inactive" ? 녹.start(250) : 녹.state === "paused" && 녹.resume()); if (bgm.src) bgm.play(); };
    try {
      for (const c of 칸들) {
        if (상태.멈춤요청) break;
        if (c.종류 === "동영상") {
          잠깐();
          vid.src = c.항목.url; await 기다려(vid, "loadedmetadata");
          vid.currentTime = c.항목.시작; await 기다려(vid, "seeked");
          장면(vid, vid.videoWidth, vid.videoHeight, c.항목, 0, c.번호); 어둡게(c.길이, 0);
          이어(); 음악크기($("origSound").checked);
          await vid.play();
          while (!상태.멈춤요청) {
            const 지난 = vid.currentTime - c.항목.시작;
            if (지난 >= c.길이 - 0.03 || vid.ended) break;
            장면(vid, vid.videoWidth, vid.videoHeight, c.항목, 지난 / c.길이, c.번호); 어둡게(c.길이 - 지난, 지난);
            진행(지난총 + 지난, 총); await 쉼();
          }
          vid.pause(); 음악크기(false);
        } else {
          이어();
          const 시작 = performance.now();
          while (!상태.멈춤요청) {
            const 지난 = (performance.now() - 시작) / 1000;
            if (지난 >= c.길이) break;
            if (c.종류 === "제목") 카드($("title").value.trim(), 날짜범위());
            else if (c.종류 === "끝") 카드($("ending").value.trim(), "");
            else 장면(c.항목.el, c.항목.el.naturalWidth, c.항목.el.naturalHeight, c.항목, 지난 / c.길이, c.번호);
            어둡게(c.길이 - 지난, 지난);
            진행(지난총 + 지난, 총); await 쉼();
          }
        }
        지난총 += c.길이;
      }
    } finally { bgm.pause(); 상태.재생중 = false; $("play").textContent = "▶ 미리보기"; }
    return !상태.멈춤요청;
  }
  function 진행(t, 총) {
    $("bar").style.width = `${Math.min(100, (t / 총) * 100)}%`;
    $("progText").textContent = `${시각(t)} / ${시각(총)}`;
  }

  $("play").addEventListener("click", async () => {
    if (상태.재생중) { 상태.멈춤요청 = true; return; }
    $("play").textContent = "❚❚ 멈춤"; $("prog").classList.remove("hidden");
    await 재생(null); 표지그리기();
  });

  $("export").addEventListener("click", async () => {
    if (상태.재생중) return;
    const 종류 = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
    if (!종류) return alert("이 브라우저는 영상 만들기(MediaRecorder)를 지원하지 않습니다. 크롬이나 엣지에서 열어 주세요.");
    $("export").disabled = true; $("prog").classList.remove("hidden");
    const 흐름 = view.captureStream(30);
    녹음목적지.stream.getAudioTracks().forEach((t) => 흐름.addTrack(t));
    const 녹 = new MediaRecorder(흐름, { mimeType: 종류, videoBitsPerSecond: 8_000_000 }), 덩이 = [];
    녹.ondataavailable = (e) => e.data.size && 덩이.push(e.data);
    try {
      const 다함 = await 재생(녹);
      const 끝남 = new Promise((ok) => (녹.onstop = ok));
      if (녹.state !== "inactive") 녹.stop();
      await 끝남;
      if (!다함) { $("progText").textContent = "멈췄습니다 — 파일을 만들지 않았어요."; return; }
      const blob = new Blob(덩이, { type: 종류.split(";")[0] }), a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${($("title").value.trim() || "추억영상").replace(/[\\/:*?"<>|]/g, "")}.${종류.startsWith("video/mp4") ? "mp4" : "webm"}`;
      document.body.appendChild(a); a.click(); a.remove();
      $("progText").textContent = `끝 — ${a.download} (${(blob.size / 1048576).toFixed(1)}MB · ${시각(총길이())})`;
    } catch (e) {
      if (녹.state !== "inactive") 녹.stop();
      $("progText").textContent = `만들지 못했습니다 — ${e.message}`;
    } finally { $("export").disabled = false; 표지그리기(); }
  });

  window.__memories = 상태;   // 시험용
})();
