(function () {
  "use strict";

  // ----- 물리 설정 -----
  // 아보가드로 법칙: 온도·압력 일정 → V / N = 상수 (N: 입자 수/몰 수)
  const N_MIN = 1.0;          // 최소 기체 양 (mol)
  const N_MAX = 10.0;         // 최대 기체 양 (mol)
  const N_REF = 5.0;          // 기준 기체 양
  const V_REF = 5.0;          // 기준에서의 부피 (L)
  const CONST = V_REF / N_REF;            // V/N 상수 = 1
  const V_MIN = CONST * N_MIN;            // 1 L
  const V_MAX = CONST * N_MAX;            // 10 L
  const PARTICLES_PER_MOL = 4;            // 1 mol당 화면 입자 수

  let moles = N_REF;          // 현재 기체 양 (mol)

  function volumeFor(n) { return CONST * n; }
  function targetCount(n) { return Math.round(n * PARTICLES_PER_MOL); }

  // ----- DOM -----
  const chamber = document.querySelector(".chamber");
  const gasEl = document.getElementById("gas");
  const pistonEl = document.getElementById("piston");
  const molSlider = document.getElementById("molSlider");
  const injectBtn = document.getElementById("injectBtn");
  const releaseBtn = document.getElementById("releaseBtn");
  const resetBtn = document.getElementById("resetBtn");
  const molVal = document.getElementById("molVal");
  const volVal = document.getElementById("volVal");
  const vnVal = document.getElementById("vnVal");
  const countVal = document.getElementById("countVal");

  // ----- 입자 시뮬레이션 -----
  // 온도·압력 일정 → 입자 속력 일정, 밀도(입자수/부피) 일정.
  // 기체를 주입하면 입자 수가 늘고, 그만큼 공간(부피)도 커진다.
  const pCanvas = document.getElementById("particles");
  const pctx = pCanvas.getContext("2d");
  const particles = [];
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let SPEED = 1.1;            // 입자 속력(px/frame) — 온도 일정이므로 고정

  function spawnParticle() {
    const w = pCanvas.width || 100;
    const h = pCanvas.height || 100;
    const r = 4 * dpr;
    const ang = Math.random() * Math.PI * 2;
    return {
      x: r + Math.random() * (w - 2 * r),
      y: r + Math.random() * (h - 2 * r),
      vx: Math.cos(ang),
      vy: Math.sin(ang),
    };
  }

  // 입자 수를 목표값에 맞춰 추가/제거
  function syncParticleCount(n) {
    const target = targetCount(n);
    while (particles.length < target) particles.push(spawnParticle());
    while (particles.length > target) particles.pop();
  }

  function sizeParticleCanvas() {
    const w = gasEl.clientWidth;
    const h = gasEl.clientHeight;
    if (w === 0 || h === 0) return;
    pCanvas.width = w * dpr;
    pCanvas.height = h * dpr;
    pCanvas.style.width = w + "px";
    pCanvas.style.height = h + "px";
    SPEED = 1.1 * dpr;
    const r = 4 * dpr;
    for (const p of particles) {
      if (p.x < r) p.x = r; else if (p.x > w * dpr - r) p.x = w * dpr - r;
      if (p.y < r) p.y = r; else if (p.y > h * dpr - r) p.y = h * dpr - r;
    }
  }

  function drawParticles() {
    const w = pCanvas.width;
    const h = pCanvas.height;
    if (w === 0 || h === 0) return;
    pctx.clearRect(0, 0, w, h);
    const r = 4 * dpr;

    pctx.fillStyle = "#a7f3d0";
    for (const p of particles) {
      p.x += p.vx * SPEED;
      p.y += p.vy * SPEED;

      if (p.x < r) { p.x = r; p.vx = Math.abs(p.vx); }
      else if (p.x > w - r) { p.x = w - r; p.vx = -Math.abs(p.vx); }
      if (p.y < r) { p.y = r; p.vy = Math.abs(p.vy); }
      else if (p.y > h - r) { p.y = h - r; p.vy = -Math.abs(p.vy); }

      pctx.beginPath();
      pctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      pctx.fill();
    }
  }

  // ----- V-N 그래프 -----
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

    const padL = 38 * dpr, padB = 26 * dpr, padT = 10 * dpr, padR = 12 * dpr;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const xOf = (n) => padL + (n / N_MAX) * plotW;
    const yOf = (v) => padT + (1 - v / V_MAX) * plotH;

    // 격자
    gctx.strokeStyle = "rgba(143,201,182,0.18)";
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
    gctx.strokeStyle = "rgba(143,201,182,0.7)";
    gctx.lineWidth = 1.5 * dpr;
    gctx.beginPath();
    gctx.moveTo(padL, padT); gctx.lineTo(padL, h - padB);
    gctx.lineTo(w - padR, h - padB);
    gctx.stroke();

    // 직선 V = CONST·N (원점에서 출발 → 정비례)
    gctx.strokeStyle = "#34d399";
    gctx.lineWidth = 2.5 * dpr;
    gctx.beginPath();
    gctx.moveTo(xOf(0), yOf(0));
    gctx.lineTo(xOf(N_MAX), yOf(volumeFor(N_MAX)));
    gctx.stroke();

    // 측정 범위 강조
    gctx.strokeStyle = "rgba(52,211,153,0.30)";
    gctx.lineWidth = 7 * dpr;
    gctx.beginPath();
    gctx.moveTo(xOf(N_MIN), yOf(volumeFor(N_MIN)));
    gctx.lineTo(xOf(N_MAX), yOf(volumeFor(N_MAX)));
    gctx.stroke();

    // 현재 측정점
    const cx = xOf(moles), cy = yOf(volumeFor(moles));
    gctx.strokeStyle = "rgba(34,211,238,0.5)";
    gctx.setLineDash([4 * dpr, 4 * dpr]);
    gctx.lineWidth = 1.5 * dpr;
    gctx.beginPath();
    gctx.moveTo(cx, cy); gctx.lineTo(cx, h - padB);
    gctx.moveTo(cx, cy); gctx.lineTo(padL, cy);
    gctx.stroke();
    gctx.setLineDash([]);

    gctx.fillStyle = "#22d3ee";
    gctx.beginPath();
    gctx.arc(cx, cy, 6 * dpr, 0, Math.PI * 2);
    gctx.fill();
    gctx.strokeStyle = "#fff";
    gctx.lineWidth = 2 * dpr;
    gctx.stroke();

    // 축 라벨
    gctx.fillStyle = "rgba(143,201,182,0.9)";
    gctx.font = `${11 * dpr}px sans-serif`;
    gctx.textAlign = "center";
    gctx.fillText("기체 양 N (mol)", padL + plotW / 2, h - 6 * dpr);
    gctx.save();
    gctx.translate(12 * dpr, padT + plotH / 2);
    gctx.rotate(-Math.PI / 2);
    gctx.fillText("부피 V (L)", 0, 0);
    gctx.restore();
  }

  // ----- 화면 업데이트 -----
  function layoutPiston() {
    const chamberH = chamber.clientHeight;
    const pistonH = pistonEl.offsetHeight;
    const usable = chamberH - pistonH;
    const vol = volumeFor(moles);
    const frac = (vol - V_MIN) / (V_MAX - V_MIN); // 0..1
    const gasH = pistonH + frac * usable;
    const clamped = Math.max(pistonH + 4, Math.min(gasH, chamberH));
    gasEl.style.height = clamped + "px";
    pistonEl.style.bottom = (clamped - pistonH / 2) + "px";
  }

  function updateReadouts() {
    const vol = volumeFor(moles);
    molVal.textContent = moles.toFixed(1);
    volVal.textContent = vol.toFixed(1);
    vnVal.textContent = (vol / moles).toFixed(2);
    countVal.textContent = particles.length;
  }

  function setMoles(n) {
    moles = Math.max(N_MIN, Math.min(N_MAX, Math.round(n * 2) / 2)); // 0.5 단위
    molSlider.value = moles;
    layoutPiston();
    sizeParticleCanvas();   // 부피(공간)가 바뀌므로 캔버스 동기화
    syncParticleCount(moles); // 입자 수도 기체 양에 맞춰 조정
    updateReadouts();
    drawGraph();
  }

  // ----- 입력 -----
  molSlider.addEventListener("input", function () {
    setMoles(parseFloat(this.value));
  });
  injectBtn.addEventListener("click", function () { setMoles(moles + 1); });
  releaseBtn.addEventListener("click", function () { setMoles(moles - 1); });
  resetBtn.addEventListener("click", function () { setMoles(N_REF); });

  // ----- 리사이즈 -----
  function onResize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    sizeParticleCanvas();
    syncParticleCount(moles);
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
    setMoles(N_REF);
    loop();
  });
})();
