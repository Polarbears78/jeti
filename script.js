(function () {
  "use strict";

  // ----- 물리 설정 -----
  // 보일 법칙: P * V = 상수 (온도 일정)
  const V_MIN = 1.0;     // 최소 부피 (L)
  const V_MAX = 10.0;    // 최대 부피 (L)
  const TEMP = 300;      // 온도 (K), 고정
  const K = 5.0;         // PV 상수: V=5L 일 때 P=1atm => K=5

  let volume = 5.0;      // 현재 부피 (L)

  // ----- DOM -----
  const chamber = document.querySelector(".chamber");
  const gasEl = document.getElementById("gas");
  const pistonEl = document.getElementById("piston");
  const gaugeNeedle = document.getElementById("gaugeNeedle");
  const volSlider = document.getElementById("volSlider");
  const resetBtn = document.getElementById("resetBtn");
  const volVal = document.getElementById("volVal");
  const presVal = document.getElementById("presVal");
  const pvVal = document.getElementById("pvVal");
  const tempVal = document.getElementById("tempVal");

  tempVal.textContent = TEMP;

  // ----- 압력 계산 -----
  function pressureFor(v) {
    return K / v; // atm
  }

  // ----- 입자 시뮬레이션 -----
  const pCanvas = document.getElementById("particles");
  const pctx = pCanvas.getContext("2d");
  const N_PARTICLES = 36;
  const particles = [];
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  function initParticles() {
    particles.length = 0;
    for (let i = 0; i < N_PARTICLES; i++) {
      particles.push({
        x: Math.random(),          // 0..1 (정규화 위치)
        y: Math.random(),
        vx: (Math.random() - 0.5),
        vy: (Math.random() - 0.5),
      });
    }
  }
  initParticles();

  function sizeParticleCanvas() {
    const w = gasEl.clientWidth;
    const h = gasEl.clientHeight;
    if (w === 0 || h === 0) return;
    pCanvas.width = w * dpr;
    pCanvas.height = h * dpr;
    pCanvas.style.width = w + "px";
    pCanvas.style.height = h + "px";
  }

  function drawParticles() {
    const w = pCanvas.width;
    const h = pCanvas.height;
    if (w === 0 || h === 0) return;
    pctx.clearRect(0, 0, w, h);

    // 부피가 작을수록 입자 속도(부딪힘) 체감이 커지도록 가속
    const pressure = pressureFor(volume);
    const speed = (0.6 + pressure * 0.5) * dpr * 1.4;
    const r = 4 * dpr;

    pctx.fillStyle = "#bae6fd";
    for (const p of particles) {
      p.x += p.vx * speed / w;
      p.y += p.vy * speed / h;

      if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx); }
      else if (p.x > 1) { p.x = 1; p.vx = -Math.abs(p.vx); }
      if (p.y < 0) { p.y = 0; p.vy = Math.abs(p.vy); }
      else if (p.y > 1) { p.y = 1; p.vy = -Math.abs(p.vy); }

      pctx.beginPath();
      pctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
      pctx.fill();
    }
  }

  // ----- P-V 그래프 -----
  const gCanvas = document.getElementById("graph");
  const gctx = gCanvas.getContext("2d");

  function sizeGraph() {
    const w = gCanvas.clientWidth;
    const h = gCanvas.clientHeight;
    gCanvas.width = w * dpr;
    gCanvas.height = h * dpr;
  }

  function drawGraph() {
    const w = gCanvas.width;
    const h = gCanvas.height;
    if (w === 0 || h === 0) return;
    gctx.clearRect(0, 0, w, h);

    const padL = 36 * dpr, padB = 26 * dpr, padT = 10 * dpr, padR = 10 * dpr;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const Pmax = pressureFor(V_MIN); // 최대 압력
    const xOf = (v) => padL + (v - V_MIN) / (V_MAX - V_MIN) * plotW;
    const yOf = (p) => padT + (1 - p / Pmax) * plotH;

    // 격자
    gctx.strokeStyle = "rgba(148,163,184,0.18)";
    gctx.lineWidth = 1 * dpr;
    gctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const gy = padT + (plotH * i) / 4;
      gctx.moveTo(padL, gy); gctx.lineTo(w - padR, gy);
    }
    for (let i = 0; i <= 5; i++) {
      const gx = padL + (plotW * i) / 5;
      gctx.moveTo(gx, padT); gctx.lineTo(gx, h - padB);
    }
    gctx.stroke();

    // 축
    gctx.strokeStyle = "rgba(148,163,184,0.7)";
    gctx.lineWidth = 1.5 * dpr;
    gctx.beginPath();
    gctx.moveTo(padL, padT); gctx.lineTo(padL, h - padB);
    gctx.lineTo(w - padR, h - padB);
    gctx.stroke();

    // 곡선 P = K/V
    gctx.strokeStyle = "#38bdf8";
    gctx.lineWidth = 2.5 * dpr;
    gctx.beginPath();
    let first = true;
    for (let v = V_MIN; v <= V_MAX + 0.001; v += 0.1) {
      const x = xOf(v), y = yOf(pressureFor(v));
      if (first) { gctx.moveTo(x, y); first = false; }
      else gctx.lineTo(x, y);
    }
    gctx.stroke();

    // 현재 측정점
    const cx = xOf(volume), cy = yOf(pressureFor(volume));
    // 점선 안내선
    gctx.strokeStyle = "rgba(244,114,182,0.5)";
    gctx.setLineDash([4 * dpr, 4 * dpr]);
    gctx.lineWidth = 1.5 * dpr;
    gctx.beginPath();
    gctx.moveTo(cx, cy); gctx.lineTo(cx, h - padB);
    gctx.moveTo(cx, cy); gctx.lineTo(padL, cy);
    gctx.stroke();
    gctx.setLineDash([]);

    gctx.fillStyle = "#f472b6";
    gctx.beginPath();
    gctx.arc(cx, cy, 6 * dpr, 0, Math.PI * 2);
    gctx.fill();
    gctx.strokeStyle = "#fff";
    gctx.lineWidth = 2 * dpr;
    gctx.stroke();

    // 축 라벨
    gctx.fillStyle = "rgba(148,163,184,0.9)";
    gctx.font = `${11 * dpr}px sans-serif`;
    gctx.textAlign = "center";
    gctx.fillText("부피 V (L)", padL + plotW / 2, h - 6 * dpr);
    gctx.save();
    gctx.translate(12 * dpr, padT + plotH / 2);
    gctx.rotate(-Math.PI / 2);
    gctx.fillText("압력 P (atm)", 0, 0);
    gctx.restore();
  }

  // ----- 화면 업데이트 -----
  function layoutPiston() {
    // 부피 -> 기체 높이 (챔버 높이에 비례)
    const chamberH = chamber.clientHeight;
    const pistonH = pistonEl.offsetHeight;
    const usable = chamberH - pistonH;
    const frac = (volume - V_MIN) / (V_MAX - V_MIN); // 0..1
    const gasH = pistonH + frac * usable; // 시각적 기체 높이
    const clamped = Math.max(pistonH + 4, Math.min(gasH, chamberH));
    gasEl.style.height = clamped + "px";
    pistonEl.style.bottom = (clamped - pistonH / 2) + "px";
  }

  function updateReadouts() {
    const p = pressureFor(volume);
    volVal.textContent = volume.toFixed(1);
    presVal.textContent = p.toFixed(2);
    pvVal.textContent = (p * volume).toFixed(2);

    // 게이지 바늘: -90deg(낮음) ~ +90deg(높음)
    const pMin = pressureFor(V_MAX), pMax = pressureFor(V_MIN);
    const t = (p - pMin) / (pMax - pMin);
    const angle = -90 + t * 180;
    gaugeNeedle.style.transform = `translateX(-50%) rotate(${angle}deg)`;

    // 압력 높을수록 기체 색 진하게
    const intensity = 0.15 + t * 0.35;
    gasEl.style.background =
      `linear-gradient(180deg, rgba(56,189,248,${intensity * 0.7}), rgba(56,189,248,${intensity}))`;

    pistonEl.setAttribute("aria-valuenow", volume.toFixed(1));
  }

  function setVolume(v, fromSlider) {
    volume = Math.max(V_MIN, Math.min(V_MAX, v));
    if (!fromSlider) volSlider.value = volume.toFixed(1);
    layoutPiston();
    updateReadouts();
    drawGraph();
  }

  // ----- 피스톤 드래그 -----
  let dragging = false;

  function pointerToVolume(clientY) {
    const rect = chamber.getBoundingClientRect();
    const pistonH = pistonEl.offsetHeight;
    // 위로 갈수록(부피 큼) clientY 작아짐
    const yFromBottom = rect.bottom - clientY; // 0(바닥) .. chamberH(천장)
    const usable = rect.height - pistonH;
    const gasH = yFromBottom; // 손가락 위치 ≈ 피스톤 중앙
    const frac = (gasH - pistonH) / usable;
    return V_MIN + frac * (V_MAX - V_MIN);
  }

  function onPointerDown(e) {
    dragging = true;
    pistonEl.setPointerCapture && pistonEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!dragging) return;
    setVolume(pointerToVolume(e.clientY), false);
    e.preventDefault();
  }
  function onPointerUp() { dragging = false; }

  pistonEl.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  // 키보드 접근성
  pistonEl.addEventListener("keydown", function (e) {
    if (e.key === "ArrowUp") { setVolume(volume + 0.2, false); e.preventDefault(); }
    else if (e.key === "ArrowDown") { setVolume(volume - 0.2, false); e.preventDefault(); }
  });

  // ----- 슬라이더 -----
  volSlider.addEventListener("input", function () {
    setVolume(parseFloat(this.value), true);
  });

  // ----- 초기화 -----
  resetBtn.addEventListener("click", function () {
    setVolume(5.0, false);
    initParticles();
  });

  // ----- 리사이즈 -----
  function onResize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    sizeParticleCanvas();
    sizeGraph();
    layoutPiston();
    drawGraph();
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", function () {
    setTimeout(onResize, 200);
  });

  // ----- 애니메이션 루프 -----
  function loop() {
    drawParticles();
    requestAnimationFrame(loop);
  }

  // 초기 실행
  requestAnimationFrame(function () {
    onResize();
    setVolume(5.0, false);
    loop();
  });
})();
