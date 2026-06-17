(function () {
  "use strict";

  // ----- 개요 -----
  // 카메라 영상을 배경으로 깔고, 기기의 가속도 센서(DeviceMotion)로
  // 가속도를 측정해 화면에 겹쳐 보여 준다(AR 느낌). |a| = √(ax²+ay²+az²).
  // 센서가 없으면 데모 신호로 측정 과정을 시연한다.
  const WINDOW = 6;          // 그래프 표시 구간(초)
  const BAR_MAX = 15;        // 축 막대 스케일(m/s²)

  // ----- DOM -----
  const video = document.getElementById("video");
  const viewHint = document.getElementById("viewHint");
  const recDot = document.getElementById("recDot");
  const startBtn = document.getElementById("startBtn");
  const measureBtn = document.getElementById("measureBtn");
  const resetBtn = document.getElementById("resetBtn");
  const gravityChk = document.getElementById("gravityChk");
  const sensorNote = document.getElementById("sensorNote");
  const trackTip = document.getElementById("trackTip");
  const magHud = document.getElementById("magHud");
  const magVal = document.getElementById("magVal");
  const maxVal = document.getElementById("maxVal");
  const timeVal = document.getElementById("timeVal");
  const barX = document.getElementById("barX");
  const barY = document.getElementById("barY");
  const barZ = document.getElementById("barZ");

  // ----- 상태 -----
  let stream = null;
  let started = false;
  let measuring = false;
  let demoActive = false;
  let sensorGot = false;
  let t0 = 0, maxMag = 0;

  // 가속도 성분 (incl: 중력 포함 / lin: 중력 제외)
  let gx = 0, gy = 0, gz = 0;          // 중력 포함
  let lx = 0, ly = 0, lz = 0;          // 중력 제외
  const gravLP = { x: 0, y: 0, z: 9.8 }; // 중력 저역통과 추정

  const samples = [];   // {t(초), mag} 링버퍼

  // ----- 센서 -----
  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || (a.x == null && a.y == null && a.z == null)) return;
    gx = a.x || 0; gy = a.y || 0; gz = a.z || 0;
    gravLP.x = gravLP.x * 0.9 + gx * 0.1;
    gravLP.y = gravLP.y * 0.9 + gy * 0.1;
    gravLP.z = gravLP.z * 0.9 + gz * 0.1;
    lx = gx - gravLP.x; ly = gy - gravLP.y; lz = gz - gravLP.z;
    if (!sensorGot) {
      sensorGot = true; demoActive = false;
      sensorNote.textContent = "센서 상태: 가속도 센서 측정 중 ✅";
    }
  }

  async function enableMotion() {
    const DME = window.DeviceMotionEvent;
    if (typeof DME !== "undefined" && typeof DME.requestPermission === "function") {
      // iOS 13+ : 사용자 제스처에서 권한 요청
      const res = await DME.requestPermission();
      if (res !== "granted") throw new Error("동작 센서 권한이 거부되었습니다.");
    }
    if (typeof DME === "undefined") throw new Error("이 기기는 동작 센서를 지원하지 않습니다.");
    window.addEventListener("devicemotion", onMotion);
    // 일정 시간 내 신호가 없으면 데모로 전환(PC 등)
    setTimeout(function () {
      if (!sensorGot) {
        demoActive = true;
        sensorNote.textContent = "센서 상태: 신호 없음 → 데모 신호로 측정 시연 중";
      }
    }, 1200);
  }

  // ----- 카메라(배경) -----
  async function startCamera() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } }, audio: false
      });
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      // 카메라 없거나 거부 → 어두운 배경 유지(센서 측정은 계속)
    }
  }

  function stopStream() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  // ----- 데모 신호 -----
  function demoSignal(now) {
    const t = now / 1000;
    lx = 4 * Math.sin(t * 2.0) + 1.2 * Math.sin(t * 7.0);
    ly = 3 * Math.sin(t * 3.0 + 1) ;
    lz = 2 * Math.sin(t * 5.0);
    gx = lx; gy = ly; gz = lz + 9.8;
  }

  // ----- 축 막대 -----
  function updateBar(el, v) {
    const frac = Math.max(-1, Math.min(1, v / BAR_MAX));
    const w = Math.abs(frac) * 50;
    el.style.width = w + "%";
    el.style.left = (frac >= 0 ? 50 : 50 - w) + "%";
  }

  // ----- 그래프 -----
  const gCanvas = document.getElementById("graph");
  const gctx = gCanvas.getContext("2d");
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  function sizeGraph() {
    const w = gCanvas.clientWidth, h = gCanvas.clientHeight;
    gCanvas.width = w * dpr; gCanvas.height = h * dpr;
  }

  function drawGraph(nowSec) {
    const w = gCanvas.width, h = gCanvas.height;
    if (w === 0 || h === 0) return;
    gctx.clearRect(0, 0, w, h);
    const padL = 40 * dpr, padB = 24 * dpr, padT = 12 * dpr, padR = 12 * dpr;
    const plotW = w - padL - padR, plotH = h - padT - padB;

    const tEnd = nowSec, tStart = tEnd - WINDOW;
    let yMax = 12;
    for (const s of samples) if (s.t >= tStart && s.mag > yMax) yMax = s.mag;
    yMax = Math.ceil(yMax / 4) * 4;

    const xOf = t => padL + ((t - tStart) / WINDOW) * plotW;
    const yOf = m => padT + (1 - m / yMax) * plotH;

    // 격자 + 축
    gctx.strokeStyle = "rgba(143,197,156,0.16)"; gctx.lineWidth = 1 * dpr;
    gctx.beginPath();
    for (let i = 0; i <= 4; i++) { const gy = padT + (plotH * i) / 4; gctx.moveTo(padL, gy); gctx.lineTo(w - padR, gy); }
    gctx.stroke();
    gctx.strokeStyle = "rgba(143,197,156,0.7)"; gctx.lineWidth = 1.5 * dpr;
    gctx.beginPath();
    gctx.moveTo(padL, padT); gctx.lineTo(padL, h - padB); gctx.lineTo(w - padR, h - padB);
    gctx.stroke();

    // |a| 트레이스
    gctx.strokeStyle = "#4ade80"; gctx.lineWidth = 2 * dpr;
    gctx.beginPath();
    let first = true;
    for (const s of samples) {
      if (s.t < tStart) continue;
      const x = xOf(s.t), y = yOf(Math.min(s.mag, yMax));
      if (first) { gctx.moveTo(x, y); first = false; } else gctx.lineTo(x, y);
    }
    gctx.stroke();

    // 최대값 점선
    if (maxMag > 0) {
      const ym = yOf(Math.min(maxMag, yMax));
      gctx.strokeStyle = "rgba(245,158,11,0.7)";
      gctx.setLineDash([4 * dpr, 4 * dpr]); gctx.lineWidth = 1.5 * dpr;
      gctx.beginPath(); gctx.moveTo(padL, ym); gctx.lineTo(w - padR, ym); gctx.stroke();
      gctx.setLineDash([]);
    }

    // 라벨
    gctx.fillStyle = "rgba(143,197,156,0.95)";
    gctx.font = `${11 * dpr}px sans-serif`;
    gctx.textAlign = "left"; gctx.fillText(yMax + " m/s²", padL + 4 * dpr, padT + 12 * dpr);
    gctx.textAlign = "center"; gctx.fillText("시간 (최근 6초)", padL + plotW / 2, h - 5 * dpr);
  }

  // ----- 메인 루프 -----
  function tick(now) {
    if (started) {
      if (demoActive) demoSignal(now);
      const useGrav = gravityChk.checked;
      const ax = useGrav ? gx : lx, ay = useGrav ? gy : ly, az = useGrav ? gz : lz;
      const mag = Math.sqrt(ax * ax + ay * ay + az * az);

      magHud.textContent = mag.toFixed(1);
      magVal.textContent = mag.toFixed(1);
      updateBar(barX, ax); updateBar(barY, ay); updateBar(barZ, az);

      const nowSec = now / 1000;
      samples.push({ t: nowSec, mag: mag });
      while (samples.length && samples[0].t < nowSec - WINDOW - 1) samples.shift();

      if (measuring) {
        if (mag > maxMag) { maxMag = mag; maxVal.textContent = maxMag.toFixed(1); }
        timeVal.textContent = ((now - t0) / 1000).toFixed(1);
      }
      drawGraph(nowSec);
    }
    requestAnimationFrame(tick);
  }

  // ----- 제어 -----
  async function startAR() {
    startBtn.disabled = true;
    startBtn.textContent = "준비 중…";
    await startCamera();
    try {
      await enableMotion();
    } catch (e) {
      demoActive = true;
      sensorNote.textContent = "센서 상태: " + (e.message || e) + " → 데모 신호로 시연";
    }
    started = true;
    viewHint.style.display = "none";
    measureBtn.disabled = false;
    startBtn.textContent = "✔ 실행 중";
    if (!sensorGot && !demoActive) sensorNote.textContent = "센서 상태: 신호 대기 중…";
  }

  function toggleMeasure() {
    if (!started) return;
    measuring = !measuring;
    if (measuring) {
      maxMag = 0; maxVal.textContent = "0.0";
      t0 = performance.now();
      measureBtn.textContent = "■ 측정 정지";
      measureBtn.classList.add("rec");
      recDot.classList.add("live");
    } else {
      measureBtn.textContent = "● 측정 시작";
      measureBtn.classList.remove("rec");
      recDot.classList.remove("live");
    }
  }

  function resetAll() {
    measuring = false;
    maxMag = 0; samples.length = 0;
    measureBtn.textContent = "● 측정 시작";
    measureBtn.classList.remove("rec");
    recDot.classList.remove("live");
    maxVal.textContent = "0.0"; timeVal.textContent = "0.0";
    drawGraph(performance.now() / 1000);
  }

  startBtn.addEventListener("click", startAR);
  measureBtn.addEventListener("click", toggleMeasure);
  resetBtn.addEventListener("click", resetAll);

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && measuring) toggleMeasure();
  });
  window.addEventListener("pagehide", stopStream);

  function onResize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    sizeGraph(); drawGraph(performance.now() / 1000);
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", function () { setTimeout(onResize, 200); });

  requestAnimationFrame(function () {
    onResize();
    requestAnimationFrame(tick);
  });
})();
