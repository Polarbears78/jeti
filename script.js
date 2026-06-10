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
  const collisionFill = document.getElementById("collisionFill");
  const collisionVal = document.getElementById("collisionVal");

  tempVal.textContent = TEMP;

  // ----- 압력 계산 -----
  function pressureFor(v) {
    return K / v; // atm
  }

  // ----- 입자 시뮬레이션 -----
  // 온도가 일정 → 입자의 속력(SPEED)은 일정하게 유지한다.
  // 부피가 줄면 캔버스(기체 공간)가 좁아져 벽 충돌이 잦아지고,
  // 이것이 압력 증가로 이어지는 보일 법칙의 원리를 보여준다.
  const pCanvas = document.getElementById("particles");
  const pctx = pCanvas.getContext("2d");
  const N_PARTICLES = 30;
  const particles = [];
  const flashes = [];          // 벽 충돌 섬광 효과
  const collisionTimes = [];   // 최근 충돌 시각(ms) 기록 → 충돌 빈도 계산
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let SPEED = 1.6;             // 입자 속력(px/frame, 온도에 비례) — resize 시 보정

  function initParticles() {
    particles.length = 0;
    const w = pCanvas.width || 100;
    const h = pCanvas.height || 100;
    const r = 4 * dpr;
    for (let i = 0; i < N_PARTICLES; i++) {
      const ang = Math.random() * Math.PI * 2;
      particles.push({
        x: r + Math.random() * (w - 2 * r),
        y: r + Math.random() * (h - 2 * r),
        vx: Math.cos(ang),     // 단위 방향벡터 (속력은 SPEED로 일정)
        vy: Math.sin(ang),
      });
    }
  }

  function sizeParticleCanvas() {
    const w = gasEl.clientWidth;
    const h = gasEl.clientHeight;
    if (w === 0 || h === 0) return;
    pCanvas.width = w * dpr;
    pCanvas.height = h * dpr;
    pCanvas.style.width = w + "px";
    pCanvas.style.height = h + "px";
    SPEED = 1.1 * dpr; // 온도 일정 → 화면 밀도에 맞춘 일정 속력
    // 캔버스 경계 안으로 입자 재배치
    const r = 4 * dpr;
    for (const p of particles) {
      if (p.x < r) p.x = r; else if (p.x > w * dpr - r) p.x = w * dpr - r;
      if (p.y < r) p.y = r; else if (p.y > h * dpr - r) p.y = h * dpr - r;
    }
  }

  function addFlash(x, y, side) {
    flashes.push({ x: x, y: y, side: side, life: 1 });
    collisionTimes.push(performance.now());
  }

  function drawParticles() {
    const w = pCanvas.width;
    const h = pCanvas.height;
    if (w === 0 || h === 0) return;
    pctx.clearRect(0, 0, w, h);
    const r = 4 * dpr;

    // --- 벽 충돌 섬광 (입자 뒤에 깔리도록 먼저 그림) ---
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      const alpha = f.life * 0.8;
      const rad = (1.4 - f.life) * 22 * dpr; // 퍼지는 반경
      const grad = pctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rad);
      grad.addColorStop(0, `rgba(244,114,182,${alpha})`);
      grad.addColorStop(1, "rgba(244,114,182,0)");
      pctx.fillStyle = grad;
      pctx.beginPath();
      pctx.arc(f.x, f.y, rad, 0, Math.PI * 2);
      pctx.fill();
      f.life -= 0.08;
      if (f.life <= 0) flashes.splice(i, 1);
    }

    // --- 입자 이동 + 벽 충돌 검출 ---
    pctx.fillStyle = "#e0f2fe";
    for (const p of particles) {
      p.x += p.vx * SPEED;
      p.y += p.vy * SPEED;

      if (p.x < r) { p.x = r; p.vx = Math.abs(p.vx); addFlash(0, p.y, "L"); }
      else if (p.x > w - r) { p.x = w - r; p.vx = -Math.abs(p.vx); addFlash(w, p.y, "R"); }
      if (p.y < r) { p.y = r; p.vy = Math.abs(p.vy); addFlash(p.x, 0, "T"); }
      else if (p.y > h - r) { p.y = h - r; p.vy = -Math.abs(p.vy); addFlash(p.x, h, "B"); }

      pctx.beginPath();
      pctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      pctx.fill();
    }

    // --- 피스톤(천장) 벽: 충돌이 잦은 윗변을 강조 표시 ---
    pctx.fillStyle = "rgba(244,114,182,0.18)";
    pctx.fillRect(0, 0, w, 3 * dpr);
  }

  // 최근 1초간 충돌 횟수 → 충돌 빈도(회/초) 갱신
  function updateCollisionRate() {
    const now = performance.now();
    while (collisionTimes.length && now - collisionTimes[0] > 1000) {
      collisionTimes.shift();
    }
    const rate = collisionTimes.length; // 지난 1초 충돌 수
    collisionVal.textContent = rate;
    // 게이지 바: 0 ~ 대략 최대치(부피 최소일 때) 기준 정규화
    const pct = Math.max(0, Math.min(100, (rate / 90) * 100));
    collisionFill.style.width = pct + "%";
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
    // 부피가 바뀌면 기체 공간(시뮬레이션 캔버스) 높이도 함께 변해야
    // 입자 개수는 그대로인 채 벽 충돌 빈도가 달라진다.
    sizeParticleCanvas();
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
    if (particles.length === 0) initParticles();
    sizeGraph();
    layoutPiston();
    drawGraph();
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", function () {
    setTimeout(onResize, 200);
  });

  // ----- 애니메이션 루프 -----
  let lastRate = 0;
  function loop(ts) {
    drawParticles();
    if (!ts || ts - lastRate > 150) { updateCollisionRate(); lastRate = ts || 0; }
    requestAnimationFrame(loop);
  }

  // 초기 실행
  requestAnimationFrame(function () {
    onResize();
    setVolume(5.0, false);
    loop();
  });
})();
