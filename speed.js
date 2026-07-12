(function () {
  "use strict";

  // ----- 개요 -----
  // 카메라 영상을 배경으로 깔고, 사용자가 탭한 물체를 템플릿 매칭(SAD)으로
  // 추적해 위치 변화 → 속력 v = Δd/Δt 를 계산한다. 기준자(실제 길이를 아는
  // 물체)로 픽셀→미터를 보정하고, v–t 그래프와 Δv, 평균 가속도를 보여 준다.
  // 카메라가 없으면 데모 화면(왕복 운동하는 공)으로 같은 과정을 체험한다.
  const PROC_W = 144;         // 처리용 다운스케일 폭(px)
  const TS = 21;              // 템플릿 한 변(px, 홀수)
  const SEARCH_R = 16;        // 프레임당 탐색 반경(px)
  const LOST_SAD = 42;        // 픽셀당 평균 SAD가 넘으면 추적 실패로 판단
  const WINDOW = 8;           // 그래프 표시 구간(초)
  const V_DT = 0.22;          // 속력 계산에 쓰는 시간 간격(초)
  const DEFAULT_VIEW_M = 1.0; // 보정 전 가정: 화면 가로 = 1 m
  const STROBE_MAX = 400;     // 운동 기록 최대 점 수
  const SNAP_W = 480;         // 다중 섬광 사진 합성 해상도(폭)
  let strobeDt = 0.25;        // 섬광(기록) 간격(초) — 선택 가능

  // ----- DOM -----
  const video = document.getElementById("video");
  const overlay = document.getElementById("overlay");
  const octx = overlay.getContext("2d");
  const viewHint = document.getElementById("viewHint");
  const recDot = document.getElementById("recDot");
  const recTime = document.getElementById("recTime");
  const startBtn = document.getElementById("startBtn");
  const measureBtn = document.getElementById("measureBtn");
  const calibBtn = document.getElementById("calibBtn");
  const resetBtn = document.getElementById("resetBtn");
  const calibPanel = document.getElementById("calibPanel");
  const calibLenInput = document.getElementById("calibLen");
  const scaleNote = document.getElementById("scaleNote");
  const trackTip = document.getElementById("trackTip");
  const speedHud = document.getElementById("speedHud");
  const vVal = document.getElementById("vVal");
  const vMaxVal = document.getElementById("vMaxVal");
  const dvVal = document.getElementById("dvVal");
  const aVal = document.getElementById("aVal");
  const distVal = document.getElementById("distVal");
  const timeVal = document.getElementById("timeVal");
  const photoCanvas = document.getElementById("photo");
  const photoCtx = photoCanvas.getContext("2d");
  const photoHint = document.getElementById("photoHint");
  const strobeSel = document.getElementById("strobeSel");
  const saveBtn = document.getElementById("saveBtn");
  const intervalRows = document.getElementById("intervalRows");

  // ----- 처리용 캔버스 -----
  const proc = document.createElement("canvas");
  const pctx = proc.getContext("2d", { willReadFrequently: true });
  let procH = 192;
  let gray = null;            // 현재 프레임 밝기(Float32Array)

  // ----- 상태 -----
  let stream = null;
  let started = false;
  let demoActive = false;
  let measuring = false;
  let viewW = 0, viewH = 0;   // 뷰포트 CSS px
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  // 추적
  let tracking = false, lost = false;
  let tx = 0, ty = 0;         // 추적 위치(proc px)
  let template = null;        // Float32Array(TS*TS)

  // 속력
  const posBuf = [];          // {t, x, y} (proc px) 최근 ~1.2초
  let vSmooth = 0, hasV = false;

  // 측정
  let t0 = 0;                 // 측정 시작(초)
  let vStart = 0, vStartSet = false, vMax = 0;
  const vSamples = [];        // {t, v} 그래프용

  // 운동 기록(다중 섬광 사진처럼 일정 시간 간격의 위치 점)
  const strobe = [];          // {x, y(proc px), el(초), label(초 눈금|null)}
  let travelDist = 0;         // 측정 중 총 이동 거리(m)

  // 다중 섬광 사진 합성: 배경 스냅샷 위에 물체 모습을 섬광 간격마다 겹쳐 찍는다
  const snap = document.createElement("canvas");       // 현재 프레임(중간 해상도)
  const sctx = snap.getContext("2d");
  const resultBase = document.createElement("canvas"); // 합성 결과(배경+물체들)
  const rctx = resultBase.getContext("2d");
  let snapH = 640;
  let photoActive = false;
  let intervalCount = 0;      // 구간 분석 표 행 번호

  // 기준자 보정(뷰포트 비율 좌표)
  let calibMode = false, calibSet = false;
  const calA = { x: 0.25, y: 0.72 };
  const calB = { x: 0.75, y: 0.72 };
  let dragHandle = null;

  // ----- 크기 -----
  function sizeViewport() {
    const vp = document.getElementById("viewport");
    viewW = vp.clientWidth; viewH = vp.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    overlay.width = viewW * dpr; overlay.height = viewH * dpr;
    procH = Math.max(48, Math.round(PROC_W * viewH / viewW));
    proc.width = PROC_W; proc.height = procH;
    snapH = Math.round(SNAP_W * viewH / viewW);
    snap.width = SNAP_W; snap.height = snapH;
    // 합성 결과는 진행 중 기록을 지키기 위해 크기가 실제로 달라질 때만 초기화
    if (resultBase.width !== SNAP_W || resultBase.height !== snapH) {
      resultBase.width = SNAP_W; resultBase.height = snapH;
    }
    gray = null;
  }

  // ----- 카메라 -----
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("no-camera");
    }
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } }, audio: false
    });
    video.srcObject = stream;
    await video.play();
  }

  function stopStream() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  // ----- 데모 장면(왕복 운동하는 공: 속도가 계속 변함) -----
  function demoBall(tSec, w, h) {
    return {
      x: w * 0.5 + w * 0.36 * Math.sin(tSec * 1.5),
      y: h * 0.45 + h * 0.03 * Math.sin(tSec * 3.0),
      r: w * 0.07
    };
  }

  function drawDemoScene(ctx, w, h, tSec) {
    ctx.fillStyle = "#101820";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(127,180,209,0.15)";
    ctx.lineWidth = 1;
    const step = w / 8;
    ctx.beginPath();
    for (let x = step; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = step; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    const b = demoBall(tSec, w, h);
    const grad = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.2, b.x, b.y, b.r);
    grad.addColorStop(0, "#fef08a");
    grad.addColorStop(1, "#d97706");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
  }

  // ----- 프레임 취득(밝기 배열) -----
  function grabFrame(nowSec) {
    if (demoActive) {
      drawDemoScene(pctx, PROC_W, procH, nowSec);
    } else {
      if (video.readyState < 2 || !video.videoWidth) return false;
      // 뷰포트(object-fit: cover)와 같은 영역이 되도록 잘라서 축소
      const vw = video.videoWidth, vh = video.videoHeight;
      const ar = viewW / viewH;
      let sw = vw, sh = vh, sx = 0, sy = 0;
      if (vw / vh > ar) { sw = vh * ar; sx = (vw - sw) / 2; }
      else { sh = vw / ar; sy = (vh - sh) / 2; }
      pctx.drawImage(video, sx, sy, sw, sh, 0, 0, PROC_W, procH);
    }
    const img = pctx.getImageData(0, 0, PROC_W, procH).data;
    if (!gray || gray.length !== PROC_W * procH) gray = new Float32Array(PROC_W * procH);
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
      gray[j] = img[i] * 0.299 + img[i + 1] * 0.587 + img[i + 2] * 0.114;
    }
    return true;
  }

  // ----- 다중 섬광 사진 -----
  function grabSnapFrame(nowSec) {
    if (demoActive) {
      drawDemoScene(sctx, SNAP_W, snapH, nowSec);
      return true;
    }
    if (video.readyState < 2 || !video.videoWidth) return false;
    const vw = video.videoWidth, vh = video.videoHeight;
    const ar = viewW / viewH;
    let sw = vw, sh = vh, sx = 0, sy = 0;
    if (vw / vh > ar) { sw = vh * ar; sx = (vw - sw) / 2; }
    else { sh = vw / ar; sy = (vh - sh) / 2; }
    sctx.drawImage(video, sx, sy, sw, sh, 0, 0, SNAP_W, snapH);
    return true;
  }

  // 측정 시작: 배경 한 장을 깔아 둔다
  function beginPhoto(nowSec) {
    if (grabSnapFrame(nowSec)) {
      rctx.drawImage(snap, 0, 0);
    } else {
      rctx.fillStyle = "#101820";
      rctx.fillRect(0, 0, SNAP_W, snapH);
    }
    photoActive = true;
    photoHint.style.display = "none";
    saveBtn.disabled = false;
    intervalRows.innerHTML = "";
    intervalCount = 0;
    renderPhoto();
  }

  // 섬광: 현재 물체 모습을 배경 위에 겹쳐 찍는다
  function stampPhoto(px, py, nowSec) {
    if (!photoActive || !grabSnapFrame(nowSec)) return;
    const sc = SNAP_W / PROC_W;
    const r = TS * 0.65 * sc;
    rctx.save();
    rctx.beginPath();
    rctx.arc(px * sc, py * sc, r, 0, Math.PI * 2);
    rctx.clip();
    rctx.drawImage(snap, 0, 0);
    rctx.restore();
  }

  // 사진 위 표시(점·연결선·시간 눈금) — 저장 시에도 같은 함수 사용
  function drawPhotoMarks(ctx, scale) {
    if (strobe.length < 1) return;
    ctx.strokeStyle = "rgba(250,204,21,0.45)";
    ctx.lineWidth = 1.5 * scale / (SNAP_W / PROC_W);
    ctx.beginPath();
    const sc = scale;
    ctx.moveTo(strobe[0].x * sc, strobe[0].y * sc);
    for (let i = 1; i < strobe.length; i++) ctx.lineTo(strobe[i].x * sc, strobe[i].y * sc);
    ctx.stroke();
    ctx.font = "700 " + Math.round(4 * sc) + "px sans-serif";
    ctx.textAlign = "center";
    for (const p of strobe) {
      ctx.fillStyle = p.label ? "#fde047" : "rgba(250,204,21,0.9)";
      ctx.beginPath();
      ctx.arc(p.x * sc, p.y * sc, (p.label ? 1.6 : 1) * sc, 0, Math.PI * 2);
      ctx.fill();
      if (p.label) {
        ctx.fillStyle = "#fef9c3";
        ctx.fillText(p.label, p.x * sc, p.y * sc - 2.6 * sc);
      }
    }
  }

  function renderPhoto() {
    const cssW = photoCanvas.clientWidth || photoCanvas.parentElement.clientWidth;
    if (!cssW) return;
    const w = Math.round(cssW * dpr);
    const h = Math.round(w * snapH / SNAP_W);
    if (photoCanvas.width !== w || photoCanvas.height !== h) {
      photoCanvas.width = w; photoCanvas.height = h;
    }
    photoCtx.clearRect(0, 0, w, h);
    if (!photoActive) return;
    photoCtx.drawImage(resultBase, 0, 0, w, h);
    drawPhotoMarks(photoCtx, w / PROC_W);
  }

  function addIntervalRow(prev, cur, d, v) {
    intervalCount++;
    const row = "<tr><td>" + intervalCount + "</td>" +
      "<td>" + prev.el.toFixed(2) + " → " + cur.el.toFixed(2) + "</td>" +
      "<td>" + (d * 100).toFixed(1) + "</td>" +
      "<td><b>" + v.toFixed(2) + "</b></td></tr>";
    intervalRows.insertAdjacentHTML("beforeend", row);
    // 스크롤을 최신 행으로
    const wrap = intervalRows.closest(".table-wrap");
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }

  function savePhoto() {
    if (!photoActive) return;
    const tmp = document.createElement("canvas");
    tmp.width = resultBase.width; tmp.height = resultBase.height;
    const tctx = tmp.getContext("2d");
    tctx.drawImage(resultBase, 0, 0);
    drawPhotoMarks(tctx, SNAP_W / PROC_W);
    const a = document.createElement("a");
    a.href = tmp.toDataURL("image/png");
    a.download = "다중섬광사진.png";
    a.click();
  }

  // ----- 템플릿 매칭 추적 -----
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function captureTemplate(cx, cy) {
    if (!gray) return false;
    const h = (TS - 1) / 2;
    cx = clamp(Math.round(cx), h, PROC_W - 1 - h);
    cy = clamp(Math.round(cy), h, procH - 1 - h);
    template = new Float32Array(TS * TS);
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        template[y * TS + x] = gray[(cy - h + y) * PROC_W + (cx - h + x)];
      }
    }
    tx = cx; ty = cy;
    return true;
  }

  function track() {
    const h = (TS - 1) / 2;
    const cx0 = Math.round(tx), cy0 = Math.round(ty);
    let best = Infinity, bx = cx0, by = cy0;
    for (let dy = -SEARCH_R; dy <= SEARCH_R; dy++) {
      const cy = cy0 + dy;
      if (cy < h || cy >= procH - h) continue;
      for (let dx = -SEARCH_R; dx <= SEARCH_R; dx++) {
        const cx = cx0 + dx;
        if (cx < h || cx >= PROC_W - h) continue;
        let s = 0;
        for (let y = 0; y < TS; y++) {
          const row = (cy - h + y) * PROC_W + (cx - h);
          const trow = y * TS;
          for (let x = 0; x < TS; x++) s += Math.abs(gray[row + x] - template[trow + x]);
          if (s >= best) break;
        }
        if (s < best) { best = s; bx = cx; by = cy; }
      }
    }
    if (best / (TS * TS) > LOST_SAD) {
      if (!lost) { posBuf.length = 0; hasV = false; }
      lost = true;
      return;
    }
    lost = false;
    tx = tx * 0.35 + bx * 0.65;
    ty = ty * 0.35 + by * 0.65;
    // 조명·모양 변화에 천천히 적응
    const cx = clamp(Math.round(tx), h, PROC_W - 1 - h);
    const cy = clamp(Math.round(ty), h, procH - 1 - h);
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        const i = y * TS + x;
        template[i] = template[i] * 0.9 + gray[(cy - h + y) * PROC_W + (cx - h + x)] * 0.1;
      }
    }
  }

  // ----- 환산(픽셀 → 미터) -----
  function metersPerProcPx() {
    const lenM = parseFloat(calibLenInput.value);
    if (calibSet && lenM > 0) {
      const dCss = Math.hypot((calA.x - calB.x) * viewW, (calA.y - calB.y) * viewH);
      const dProc = dCss * (PROC_W / viewW);
      if (dProc > 4) return lenM / dProc;
    }
    return DEFAULT_VIEW_M / PROC_W;
  }

  function updateScaleNote() {
    const mpp = metersPerProcPx();
    const cssPerM = (1 / mpp) * (viewW / PROC_W);
    if (calibSet) {
      scaleNote.textContent = "현재 환산: 화면에서 1 m ≈ " + Math.round(cssPerM) + " px";
    } else {
      scaleNote.textContent = "현재 환산: 기본값(화면 가로 ≈ 1 m)";
    }
  }

  // ----- 속력 -----
  function updateVelocity(nowSec) {
    posBuf.push({ t: nowSec, x: tx, y: ty });
    while (posBuf.length && posBuf[0].t < nowSec - 1.2) posBuf.shift();
    let old = null;
    for (let i = posBuf.length - 1; i >= 0; i--) {
      if (nowSec - posBuf[i].t >= V_DT) { old = posBuf[i]; break; }
    }
    if (!old) return;
    const mpp = metersPerProcPx();
    const d = Math.hypot(tx - old.x, ty - old.y) * mpp;
    const v = d / (nowSec - old.t);
    vSmooth = hasV ? vSmooth * 0.7 + v * 0.3 : v;
    hasV = true;
  }

  // ----- 그래프 -----
  const gCanvas = document.getElementById("graph");
  const gctx = gCanvas.getContext("2d");

  function sizeGraph() {
    gCanvas.width = gCanvas.clientWidth * dpr;
    gCanvas.height = gCanvas.clientHeight * dpr;
  }

  function drawGraph(nowSec) {
    const w = gCanvas.width, h = gCanvas.height;
    if (w === 0 || h === 0) return;
    gctx.clearRect(0, 0, w, h);
    const padL = 44 * dpr, padB = 24 * dpr, padT = 12 * dpr, padR = 12 * dpr;
    const plotW = w - padL - padR, plotH = h - padT - padB;

    const tEnd = nowSec, tStart = tEnd - WINDOW;
    let yMax = 1;
    for (const s of vSamples) if (s.t >= tStart && s.v > yMax) yMax = s.v;
    yMax = Math.ceil(yMax * 2) / 2;

    const xOf = t => padL + ((t - tStart) / WINDOW) * plotW;
    const yOf = v => padT + (1 - v / yMax) * plotH;

    // 격자 + 축
    gctx.strokeStyle = "rgba(127,180,209,0.16)"; gctx.lineWidth = 1 * dpr;
    gctx.beginPath();
    for (let i = 0; i <= 4; i++) { const gy = padT + (plotH * i) / 4; gctx.moveTo(padL, gy); gctx.lineTo(w - padR, gy); }
    gctx.stroke();
    gctx.strokeStyle = "rgba(127,180,209,0.7)"; gctx.lineWidth = 1.5 * dpr;
    gctx.beginPath();
    gctx.moveTo(padL, padT); gctx.lineTo(padL, h - padB); gctx.lineTo(w - padR, h - padB);
    gctx.stroke();

    // 측정 시작 시점 표시
    if (measuring && t0 >= tStart) {
      gctx.strokeStyle = "rgba(239,68,68,0.6)";
      gctx.setLineDash([3 * dpr, 3 * dpr]); gctx.lineWidth = 1.5 * dpr;
      gctx.beginPath(); gctx.moveTo(xOf(t0), padT); gctx.lineTo(xOf(t0), h - padB); gctx.stroke();
      gctx.setLineDash([]);
    }

    // v 트레이스
    gctx.strokeStyle = "#22d3ee"; gctx.lineWidth = 2 * dpr;
    gctx.beginPath();
    let first = true;
    for (const s of vSamples) {
      if (s.t < tStart) continue;
      const x = xOf(s.t), y = yOf(Math.min(s.v, yMax));
      if (first) { gctx.moveTo(x, y); first = false; } else gctx.lineTo(x, y);
    }
    gctx.stroke();

    // 최대 속력 점선
    if (vMax > 0) {
      const ym = yOf(Math.min(vMax, yMax));
      gctx.strokeStyle = "rgba(250,204,21,0.7)";
      gctx.setLineDash([4 * dpr, 4 * dpr]); gctx.lineWidth = 1.5 * dpr;
      gctx.beginPath(); gctx.moveTo(padL, ym); gctx.lineTo(w - padR, ym); gctx.stroke();
      gctx.setLineDash([]);
    }

    // 라벨
    gctx.fillStyle = "rgba(127,180,209,0.95)";
    gctx.font = `${11 * dpr}px sans-serif`;
    gctx.textAlign = "left"; gctx.fillText(yMax + " m/s", padL + 4 * dpr, padT + 12 * dpr);
    gctx.textAlign = "center"; gctx.fillText("시간 (최근 8초)", padL + plotW / 2, h - 5 * dpr);
  }

  // ----- 오버레이 -----
  function drawOverlay(nowSec) {
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, viewW, viewH);
    if (demoActive && started) drawDemoScene(octx, viewW, viewH, nowSec);

    const s = viewW / PROC_W; // proc px → CSS px

    // 운동 기록(스트로보 점): 점 간격이 넓을수록 빠르게 움직인 구간
    if (strobe.length > 1) {
      octx.strokeStyle = "rgba(250,204,21,0.3)";
      octx.lineWidth = 1.5;
      octx.beginPath();
      octx.moveTo(strobe[0].x * s, strobe[0].y * s);
      for (let i = 1; i < strobe.length; i++) octx.lineTo(strobe[i].x * s, strobe[i].y * s);
      octx.stroke();
      octx.font = "700 11px sans-serif";
      octx.textAlign = "center";
      for (const p of strobe) {
        octx.fillStyle = p.label ? "#fde047" : "rgba(250,204,21,0.85)";
        octx.beginPath();
        octx.arc(p.x * s, p.y * s, p.label ? 5 : 3, 0, Math.PI * 2);
        octx.fill();
        if (p.label) {
          octx.fillStyle = "#fef9c3";
          octx.fillText(p.label, p.x * s, p.y * s - 9);
        }
      }
    }

    if (tracking) {
      // 이동 궤적
      if (posBuf.length > 1) {
        octx.strokeStyle = "rgba(34,211,238,0.55)";
        octx.lineWidth = 2;
        octx.beginPath();
        octx.moveTo(posBuf[0].x * s, posBuf[0].y * s);
        for (let i = 1; i < posBuf.length; i++) octx.lineTo(posBuf[i].x * s, posBuf[i].y * s);
        octx.stroke();
      }
      // 추적 박스
      const bs = TS * s;
      octx.strokeStyle = lost ? "#ef4444" : "#22d3ee";
      octx.lineWidth = 2.5;
      octx.strokeRect(tx * s - bs / 2, ty * s - bs / 2, bs, bs);
      // 속도 화살표(최근 이동 방향, 길이 ∝ 속력)
      if (!lost && hasV && posBuf.length > 2) {
        const p0 = posBuf[Math.max(0, posBuf.length - 6)];
        const dx = tx - p0.x, dy = ty - p0.y;
        const len = Math.hypot(dx, dy);
        if (len > 0.8) {
          const al = Math.min(70, 14 + vSmooth * 40);
          const ux = dx / len, uy = dy / len;
          const x1 = tx * s + ux * bs * 0.7, y1 = ty * s + uy * bs * 0.7;
          const x2 = x1 + ux * al, y2 = y1 + uy * al;
          octx.strokeStyle = "#facc15"; octx.lineWidth = 3;
          octx.beginPath(); octx.moveTo(x1, y1); octx.lineTo(x2, y2);
          octx.moveTo(x2, y2);
          octx.lineTo(x2 - ux * 9 - uy * 6, y2 - uy * 9 + ux * 6);
          octx.moveTo(x2, y2);
          octx.lineTo(x2 - ux * 9 + uy * 6, y2 - uy * 9 - ux * 6);
          octx.stroke();
        }
      }
      // 상태 라벨
      octx.font = "700 12px sans-serif";
      octx.textAlign = "center";
      octx.fillStyle = lost ? "#fca5a5" : "#a5f3fc";
      octx.fillText(lost ? "놓침! 다시 탭하세요" : vSmooth.toFixed(2) + " m/s",
        tx * s, ty * s - bs / 2 - 8);
    }

    // 기준자
    if (calibMode) {
      const ax = calA.x * viewW, ay = calA.y * viewH;
      const bx = calB.x * viewW, by = calB.y * viewH;
      octx.strokeStyle = "#facc15"; octx.lineWidth = 3;
      octx.beginPath(); octx.moveTo(ax, ay); octx.lineTo(bx, by); octx.stroke();
      for (const [hx, hy] of [[ax, ay], [bx, by]]) {
        octx.fillStyle = "rgba(250,204,21,0.25)";
        octx.beginPath(); octx.arc(hx, hy, 16, 0, Math.PI * 2); octx.fill();
        octx.fillStyle = "#facc15";
        octx.beginPath(); octx.arc(hx, hy, 6, 0, Math.PI * 2); octx.fill();
      }
      const lenM = parseFloat(calibLenInput.value) || 0;
      octx.font = "700 13px sans-serif";
      octx.textAlign = "center";
      octx.fillStyle = "#fef08a";
      octx.fillText(lenM > 0 ? lenM.toFixed(2) + " m" : "길이를 입력하세요",
        (ax + bx) / 2, (ay + by) / 2 - 14);
    }
  }

  // ----- 메인 루프 -----
  function tick(now) {
    const nowSec = now / 1000;
    if (started && gray !== undefined) {
      const ok = grabFrame(nowSec);
      if (ok && tracking && template) {
        track();
        if (!lost) updateVelocity(nowSec);
      }

      const vShow = tracking && !lost && hasV ? vSmooth : 0;
      speedHud.textContent = vShow.toFixed(2);
      vVal.textContent = vShow.toFixed(2);

      if (tracking && !lost && hasV) {
        vSamples.push({ t: nowSec, v: vSmooth });
        while (vSamples.length && vSamples[0].t < nowSec - WINDOW - 1) vSamples.shift();
      }

      if (measuring && tracking && !lost && hasV) {
        if (!vStartSet) { vStart = vSmooth; vStartSet = true; t0 = nowSec; }
        if (vSmooth > vMax) { vMax = vSmooth; vMaxVal.textContent = vMax.toFixed(2); }
        const dv = vSmooth - vStart;
        const el = nowSec - t0;
        dvVal.textContent = (dv >= 0 ? "+" : "") + dv.toFixed(2);
        aVal.textContent = el > 0.3 ? (dv / el).toFixed(2) : "0.00";
        recTime.textContent = el.toFixed(1) + " s";
        timeVal.textContent = el.toFixed(1);

        // 운동 기록: 섬광 간격마다 위치 점 + 물체 모습 + 구간 분석 기록
        const last = strobe[strobe.length - 1];
        if (!last || el - last.el >= strobeDt) {
          const label = (!last || Math.floor(el) > Math.floor(last.el)) && el >= 1
            ? Math.floor(el) + "s" : null;
          const cur = { x: tx, y: ty, el: el, label: label };
          if (last) {
            const d = Math.hypot(tx - last.x, ty - last.y) * metersPerProcPx();
            travelDist += d;
            addIntervalRow(last, cur, d, d / (el - last.el));
          }
          strobe.push(cur);
          if (strobe.length > STROBE_MAX) strobe.shift();
          distVal.textContent = travelDist.toFixed(2);
          stampPhoto(tx, ty, nowSec);
          renderPhoto();
        }
      }

      drawOverlay(nowSec);
      drawGraph(nowSec);
    }
    requestAnimationFrame(tick);
  }

  // ----- 포인터(탭=추적 시작 / 기준자 드래그) -----
  function pointerPos(e) {
    const rect = overlay.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  overlay.addEventListener("pointerdown", function (e) {
    if (!started) return;
    const p = pointerPos(e);
    if (calibMode) {
      const dA = Math.hypot(p.x - calA.x * viewW, p.y - calA.y * viewH);
      const dB = Math.hypot(p.x - calB.x * viewW, p.y - calB.y * viewH);
      if (Math.min(dA, dB) < 34) {
        dragHandle = dA <= dB ? calA : calB;
        overlay.setPointerCapture(e.pointerId);
      }
      return;
    }
    // 추적 대상 지정: 탭한 순간 추적 + 측정이 바로 시작된다.
    // 이미 측정 중이면(추적을 놓쳐 다시 탭한 경우) 기록을 유지한 채 추적만 재개.
    if (captureTemplate(p.x / viewW * PROC_W, p.y / viewH * procH)) {
      tracking = true; lost = false;
      posBuf.length = 0; hasV = false; vSmooth = 0;
      if (!measuring) toggleMeasure();
      trackTip.innerHTML = "🎯 측정 중입니다. 놓치면 물체를 <b>다시 탭</b>하세요. (■ 버튼으로 정지)";
    }
    e.preventDefault();
  });

  overlay.addEventListener("pointermove", function (e) {
    if (!dragHandle) return;
    const p = pointerPos(e);
    dragHandle.x = clamp(p.x / viewW, 0.03, 0.97);
    dragHandle.y = clamp(p.y / viewH, 0.03, 0.97);
    updateScaleNote();
    e.preventDefault();
  });

  function endDrag() { dragHandle = null; }
  overlay.addEventListener("pointerup", endDrag);
  overlay.addEventListener("pointercancel", endDrag);

  // ----- 제어 -----
  async function startAR() {
    startBtn.disabled = true;
    startBtn.textContent = "준비 중…";
    try {
      await startCamera();
      trackTip.innerHTML = "💡 폰을 고정하고, 화면 속 <b>움직이는 물체를 탭</b>하면 바로 측정이 시작됩니다.";
    } catch (err) {
      demoActive = true;
      trackTip.innerHTML = "📺 카메라를 사용할 수 없어 <b>데모 화면</b>입니다. 움직이는 공을 탭하면 바로 측정이 시작됩니다.";
    }
    started = true;
    viewHint.style.display = "none";
    measureBtn.disabled = false;
    calibBtn.disabled = false;
    startBtn.textContent = "✔ 실행 중";
  }

  function toggleMeasure() {
    if (!started) return;
    measuring = !measuring;
    if (measuring) {
      vMax = 0; vStartSet = false;
      strobe.length = 0; travelDist = 0;
      vMaxVal.textContent = "0.00"; dvVal.textContent = "0.00"; aVal.textContent = "0.00";
      distVal.textContent = "0.00"; timeVal.textContent = "0.0";
      t0 = performance.now() / 1000;
      beginPhoto(t0);
      measureBtn.textContent = "■ 측정 정지";
      measureBtn.classList.add("rec");
      recDot.classList.add("live");
    } else {
      measureBtn.textContent = "● 측정 시작";
      measureBtn.classList.remove("rec");
      recDot.classList.remove("live");
      recTime.textContent = "";
    }
  }

  function toggleCalib() {
    calibMode = !calibMode;
    if (calibMode) calibSet = true;
    calibPanel.hidden = !calibMode;
    calibBtn.classList.toggle("on", calibMode);
    updateScaleNote();
  }

  function resetAll() {
    measuring = false;
    tracking = false; lost = false;
    template = null;
    posBuf.length = 0; vSamples.length = 0;
    strobe.length = 0; travelDist = 0;
    vSmooth = 0; hasV = false; vMax = 0; vStartSet = false;
    measureBtn.textContent = "● 측정 시작";
    measureBtn.classList.remove("rec");
    recDot.classList.remove("live");
    recTime.textContent = "";
    speedHud.textContent = "0.00";
    vVal.textContent = "0.00"; vMaxVal.textContent = "0.00";
    dvVal.textContent = "0.00"; aVal.textContent = "0.00";
    distVal.textContent = "0.00"; timeVal.textContent = "0.0";
    photoActive = false; intervalCount = 0;
    rctx.clearRect(0, 0, SNAP_W, snapH);
    photoHint.style.display = "";
    saveBtn.disabled = true;
    intervalRows.innerHTML = "<tr><td colspan=\"4\" class=\"empty-row\">측정하면 구간별 분석이 표시됩니다</td></tr>";
    renderPhoto();
    if (started) {
      trackTip.innerHTML = demoActive
        ? "📺 데모 화면입니다. 움직이는 공을 <b>탭</b>하면 바로 측정이 시작됩니다."
        : "💡 폰을 고정하고, 화면 속 <b>움직이는 물체를 탭</b>하면 바로 측정이 시작됩니다.";
    }
    drawGraph(performance.now() / 1000);
  }

  startBtn.addEventListener("click", startAR);
  measureBtn.addEventListener("click", toggleMeasure);
  calibBtn.addEventListener("click", toggleCalib);
  resetBtn.addEventListener("click", resetAll);
  calibLenInput.addEventListener("input", updateScaleNote);
  strobeSel.addEventListener("change", function () {
    strobeDt = parseFloat(strobeSel.value) || 0.25;
  });
  saveBtn.addEventListener("click", savePhoto);

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && measuring) toggleMeasure();
  });
  window.addEventListener("pagehide", stopStream);

  function onResize() {
    sizeViewport();
    sizeGraph();
    // 처리 해상도가 바뀌면 기존 템플릿 좌표가 무효 → 추적만 재시작
    if (tracking) {
      tracking = false; lost = false; template = null;
      posBuf.length = 0; hasV = false;
      if (started) trackTip.innerHTML = "화면 크기가 바뀌었어요. 물체를 <b>다시 탭</b>해 주세요.";
    }
    updateScaleNote();
    drawGraph(performance.now() / 1000);
    renderPhoto();
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", function () { setTimeout(onResize, 200); });

  requestAnimationFrame(function () {
    onResize();
    requestAnimationFrame(tick);
  });
})();
