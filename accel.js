(function () {
  "use strict";

  // ----- 개요 -----
  // 카메라(또는 데모) 영상에서 단색 물체를 색으로 추적해 위치 → 속도 → 가속도를 구한다.
  // 위치 y는 화면 위에서 아래로(낙하 방향) 양(+). 속도 v = Δy/Δt, 가속도 a = v-t 그래프 기울기.
  const CW = 360, CH = 480;          // 처리 캔버스 해상도(3:4 고정)
  const COLOR_TOL2 = 70 * 70;        // 색 일치 허용 거리(제곱)
  const MIN_COUNT = 10;              // 물체로 인정할 최소 픽셀 수
  const STEP = 3;                    // 픽셀 샘플 간격(성능)
  const G = 9.8;                     // 데모 낙하 가속도

  // ----- DOM -----
  const video = document.getElementById("video");
  const view = document.getElementById("view");
  const vctx = view.getContext("2d", { willReadFrequently: true });
  const viewHint = document.getElementById("viewHint");
  const recDot = document.getElementById("recDot");
  const camBtn = document.getElementById("camBtn");
  const demoBtn = document.getElementById("demoBtn");
  const measureBtn = document.getElementById("measureBtn");
  const resetBtn = document.getElementById("resetBtn");
  const scaleInput = document.getElementById("scaleInput");
  const trackTip = document.getElementById("trackTip");
  const posVal = document.getElementById("posVal");
  const velVal = document.getElementById("velVal");
  const accVal = document.getElementById("accVal");

  view.width = CW; view.height = CH;

  // ----- 상태 -----
  let mode = "idle";          // idle | camera | demo
  let stream = null;
  let target = null;          // 추적 색 {r,g,b}
  let measuring = false;
  let t0 = 0;                 // 측정 시작 시각
  let demoT0 = 0;             // 데모 낙하 시작 시각
  let demoLanded = false;     // 데모 공이 바닥에 닿음
  const trail = [];           // 화면 표시용 궤적(px)
  const samples = [];         // 측정 데이터 [{t, y}]
  let emaY = null;            // 위치 평활값(m)
  let lastY = null, lastT = null, vNow = 0, aNow = 0;

  function scaleM() {
    const v = parseFloat(scaleInput.value);
    return (isFinite(v) && v > 0) ? v : 4.0;
  }
  function metersPerPx() { return scaleM() / CH; }

  // ----- 소스 렌더링 -----
  function drawCover(img, iw, ih) {
    const s = Math.max(CW / iw, CH / ih);
    const w = iw * s, h = ih * s;
    vctx.drawImage(img, (CW - w) / 2, (CH - h) / 2, w, h);
  }

  function drawDemo(now) {
    // 배경
    const g = vctx.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, "#0b1411"); g.addColorStop(1, "#06100c");
    vctx.fillStyle = g; vctx.fillRect(0, 0, CW, CH);
    // 바닥 눈금(시각 참고)
    vctx.strokeStyle = "rgba(74,222,128,0.10)"; vctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const y = (CH * i) / 8;
      vctx.beginPath(); vctx.moveTo(0, y); vctx.lineTo(CW, y); vctx.stroke();
    }
    // 자유낙하 공: y(m) = 0.5 g t^2 → px
    let t = (now - demoT0) / 1000;
    const mpp = metersPerPx();
    let yM = 0.5 * G * t * t;
    const maxYm = (CH - 20) * mpp;
    demoLanded = false;
    if (yM >= maxYm) {
      // 측정 중에는 바닥에서 멈춤(깨끗한 1회 낙하), 평소엔 반복 낙하
      if (measuring) { yM = maxYm; demoLanded = true; }
      else { demoT0 = now; yM = 0; }
    }
    const cy = 20 + yM / mpp;
    const cx = CW / 2;
    vctx.beginPath();
    vctx.arc(cx, cy, 16, 0, Math.PI * 2);
    vctx.fillStyle = "#ef4444"; vctx.fill();
  }

  // ----- 색 추적 -----
  function track() {
    if (!target) return null;
    let data;
    try { data = vctx.getImageData(0, 0, CW, CH).data; }
    catch (e) { return null; }
    let sx = 0, sy = 0, n = 0;
    const tr = target.r, tg = target.g, tb = target.b;
    for (let y = 0; y < CH; y += STEP) {
      for (let x = 0; x < CW; x += STEP) {
        const i = (y * CW + x) * 4;
        const dr = data[i] - tr, dg = data[i + 1] - tg, db = data[i + 2] - tb;
        if (dr * dr + dg * dg + db * db < COLOR_TOL2) { sx += x; sy += y; n++; }
      }
    }
    if (n < MIN_COUNT) return null;
    return { x: sx / n, y: sy / n, n: n };
  }

  function drawOverlay(c) {
    // 궤적
    if (trail.length > 1) {
      vctx.beginPath();
      vctx.moveTo(trail[0].x, trail[0].y);
      for (let i = 1; i < trail.length; i++) vctx.lineTo(trail[i].x, trail[i].y);
      vctx.strokeStyle = "rgba(74,222,128,0.7)"; vctx.lineWidth = 2; vctx.stroke();
    }
    if (c) {
      vctx.beginPath();
      vctx.arc(c.x, c.y, 14, 0, Math.PI * 2);
      vctx.strokeStyle = "#4ade80"; vctx.lineWidth = 3; vctx.stroke();
      vctx.beginPath();
      vctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2);
      vctx.fillStyle = "#4ade80"; vctx.fill();
    }
  }

  // ----- 선형회귀: 기울기(가속도) -----
  function regressionSlope(ts, vs) {
    const n = ts.length;
    if (n < 2) return 0;
    let st = 0, sv = 0;
    for (let i = 0; i < n; i++) { st += ts[i]; sv += vs[i]; }
    const mt = st / n, mv = sv / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      const dt = ts[i] - mt;
      num += dt * (vs[i] - mv); den += dt * dt;
    }
    return den === 0 ? 0 : num / den;
  }

  // 측정 데이터에서 속도열·가속도 계산
  function computeKinematics() {
    const ts = [], vs = [];
    for (let i = 1; i < samples.length; i++) {
      const dt = samples[i].t - samples[i - 1].t;
      if (dt <= 0) continue;
      vs.push((samples[i].y - samples[i - 1].y) / dt);
      ts.push((samples[i].t + samples[i - 1].t) / 2);
    }
    const a = regressionSlope(ts, vs);
    return { ts, vs, a };
  }

  // ----- v-t 그래프 -----
  const gCanvas = document.getElementById("graph");
  const gctx = gCanvas.getContext("2d");
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  function sizeGraph() {
    const w = gCanvas.clientWidth, h = gCanvas.clientHeight;
    gCanvas.width = w * dpr; gCanvas.height = h * dpr;
  }

  function drawGraph() {
    const w = gCanvas.width, h = gCanvas.height;
    if (w === 0 || h === 0) return;
    gctx.clearRect(0, 0, w, h);
    const padL = 42 * dpr, padB = 26 * dpr, padT = 12 * dpr, padR = 12 * dpr;
    const plotW = w - padL - padR, plotH = h - padT - padB;

    const k = computeKinematics();
    const ts = k.ts, vs = k.vs;

    // 범위
    let tMax = 1, vMin = 0, vMax = 1;
    if (ts.length) {
      tMax = Math.max(1, ts[ts.length - 1]);
      vMin = Math.min(0, ...vs); vMax = Math.max(1, ...vs);
      const pad = (vMax - vMin) * 0.1 || 0.5;
      vMin -= pad; vMax += pad;
    }
    const xOf = t => padL + (t / tMax) * plotW;
    const yOf = v => padT + (1 - (v - vMin) / (vMax - vMin)) * plotH;

    // 격자 + 축
    gctx.strokeStyle = "rgba(143,197,156,0.16)"; gctx.lineWidth = 1 * dpr;
    gctx.beginPath();
    for (let i = 0; i <= 4; i++) { const gy = padT + (plotH * i) / 4; gctx.moveTo(padL, gy); gctx.lineTo(w - padR, gy); }
    for (let i = 0; i <= 4; i++) { const gx = padL + (plotW * i) / 4; gctx.moveTo(gx, padT); gctx.lineTo(gx, h - padB); }
    gctx.stroke();
    gctx.strokeStyle = "rgba(143,197,156,0.7)"; gctx.lineWidth = 1.5 * dpr;
    gctx.beginPath();
    gctx.moveTo(padL, padT); gctx.lineTo(padL, h - padB); gctx.lineTo(w - padR, h - padB);
    gctx.stroke();

    // 회귀 직선
    if (ts.length >= 2) {
      const a = k.a;
      // 평균점을 지나는 직선 v = a(t - mt) + mv
      let st = 0, sv = 0; for (let i = 0; i < ts.length; i++) { st += ts[i]; sv += vs[i]; }
      const mt = st / ts.length, mv = sv / ts.length;
      const vAt = t => a * (t - mt) + mv;
      gctx.strokeStyle = "#f59e0b"; gctx.lineWidth = 2.5 * dpr;
      gctx.beginPath();
      gctx.moveTo(xOf(0), yOf(vAt(0)));
      gctx.lineTo(xOf(tMax), yOf(vAt(tMax)));
      gctx.stroke();
    }

    // 측정점
    gctx.fillStyle = "#4ade80";
    for (let i = 0; i < ts.length; i++) {
      gctx.beginPath();
      gctx.arc(xOf(ts[i]), yOf(vs[i]), 3 * dpr, 0, Math.PI * 2);
      gctx.fill();
    }

    // 라벨
    gctx.fillStyle = "rgba(143,197,156,0.95)";
    gctx.font = `${11 * dpr}px sans-serif`;
    gctx.textAlign = "center";
    gctx.fillText("시간 t (s)", padL + plotW / 2, h - 5 * dpr);
    gctx.save();
    gctx.translate(12 * dpr, padT + plotH / 2);
    gctx.rotate(-Math.PI / 2);
    gctx.fillText("속도 v (m/s)", 0, 0);
    gctx.restore();
  }

  // ----- 메인 루프 -----
  function tick(now) {
    if (mode === "camera" && video.readyState >= 2) {
      drawCover(video, video.videoWidth || CW, video.videoHeight || CH);
    } else if (mode === "demo") {
      drawDemo(now);
    }

    if (mode !== "idle") {
      const c = track();
      if (c) {
        trail.push({ x: c.x, y: c.y });
        if (trail.length > 60) trail.shift();
        const mpp = metersPerPx();
        const yM = c.y * mpp;              // 위에서 아래로 양(+)
        emaY = emaY == null ? yM : emaY * 0.6 + yM * 0.4;
        if (lastT != null) {
          const dt = (now - lastT) / 1000;
          if (dt > 0) vNow = (emaY - lastY) / dt;
        }
        lastY = emaY; lastT = now;
        posVal.textContent = yM.toFixed(2);
        velVal.textContent = vNow.toFixed(2);

        if (measuring) {
          samples.push({ t: (now - t0) / 1000, y: yM });
          if (samples.length > 600) samples.shift();
          const k = computeKinematics();
          aNow = k.a;
          accVal.textContent = aNow.toFixed(1);
        }
      }
      drawOverlay(c);
    }

    if (measuring) drawGraph();
    // 데모: 한 번의 낙하가 끝나면 자동으로 측정 정지
    if (measuring && mode === "demo" && demoLanded) toggleMeasure();
    requestAnimationFrame(tick);
  }

  // ----- 카메라 -----
  async function startCamera() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("이 브라우저는 카메라 접근을 지원하지 않습니다.");
      }
      stopStream();
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } }, audio: false
      });
      video.srcObject = stream;
      await video.play();
      mode = "camera";
      target = null;
      viewHint.style.display = "none";
      measureBtn.disabled = false;
      trackTip.textContent = "💡 추적할 물체를 화면에서 한 번 탭하면 그 색을 따라갑니다.";
    } catch (err) {
      viewHint.style.display = "flex";
      viewHint.textContent = "카메라를 열 수 없습니다: " + (err && err.message ? err.message : err) +
        " — ‘데모(가상 공)’로 체험해 보세요.";
    }
  }

  function stopStream() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  // ----- 데모 -----
  function startDemo() {
    stopStream();
    mode = "demo";
    demoT0 = performance.now();
    target = { r: 239, g: 68, b: 68 }; // 빨간 공 자동 추적
    viewHint.style.display = "none";
    measureBtn.disabled = false;
    trackTip.textContent = "🧪 데모: 빨간 공이 자유낙하합니다. ‘측정 시작’을 누르면 가속도(≈9.8)를 분석해요.";
  }

  // ----- 측정 토글 -----
  function toggleMeasure() {
    if (mode === "idle") return;
    measuring = !measuring;
    if (measuring) {
      if (!target) {
        trackTip.textContent = "⚠️ 먼저 추적할 물체를 화면에서 탭해 색을 지정하세요.";
        measuring = false;
        return;
      }
      samples.length = 0;
      trail.length = 0;
      emaY = lastY = lastT = null;
      t0 = performance.now();
      if (mode === "demo") { demoT0 = t0; demoLanded = false; } // 측정과 함께 새 낙하 시작
      measureBtn.textContent = "■ 측정 정지";
      measureBtn.classList.add("rec");
      recDot.classList.add("live");
    } else {
      measureBtn.textContent = "● 측정 시작";
      measureBtn.classList.remove("rec");
      recDot.classList.remove("live");
      drawGraph();
    }
  }

  function resetAll() {
    measuring = false;
    samples.length = 0; trail.length = 0;
    emaY = lastY = lastT = null; vNow = aNow = 0;
    measureBtn.textContent = "● 측정 시작";
    measureBtn.classList.remove("rec");
    recDot.classList.remove("live");
    posVal.textContent = "0.00"; velVal.textContent = "0.00"; accVal.textContent = "0.0";
    drawGraph();
  }

  // 화면 탭 → 색 지정
  view.addEventListener("pointerdown", function (e) {
    if (mode === "idle") return;
    const rect = view.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / rect.width * CW);
    const y = Math.round((e.clientY - rect.top) / rect.height * CH);
    try {
      const d = vctx.getImageData(Math.max(0, Math.min(CW - 1, x)), Math.max(0, Math.min(CH - 1, y)), 1, 1).data;
      target = { r: d[0], g: d[1], b: d[2] };
      trail.length = 0;
      trackTip.textContent = `🎯 지정한 색 RGB(${d[0]}, ${d[1]}, ${d[2]})을(를) 추적합니다.`;
    } catch (err) {}
  });

  camBtn.addEventListener("click", startCamera);
  demoBtn.addEventListener("click", startDemo);
  measureBtn.addEventListener("click", toggleMeasure);
  resetBtn.addEventListener("click", resetAll);
  scaleInput.addEventListener("change", function () { if (measuring) drawGraph(); });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { measuring = false; recDot.classList.remove("live"); }
  });
  window.addEventListener("pagehide", stopStream);

  function onResize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    sizeGraph(); drawGraph();
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", function () { setTimeout(onResize, 200); });

  requestAnimationFrame(function () {
    onResize();
    requestAnimationFrame(tick);
  });
})();
