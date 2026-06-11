(function () {
  "use strict";

  // ----- 물리 설정 -----
  // 샤를 법칙: 압력 일정 → V / T = 상수 (T는 절대온도 K)
  const T_MIN = 100;     // 최소 온도 (K)
  const T_MAX = 600;     // 최대 온도 (K)
  const T_REF = 300;     // 기준 온도
  const V_REF = 5.0;     // 기준 온도에서의 부피 (L)
  const CONST = V_REF / T_REF;          // V/T 상수 = 5/300
  const V_MIN = CONST * T_MIN;          // 1.67 L
  const V_MAX = CONST * T_MAX;          // 10.0 L
  const PRESSURE = 1.0;                 // 압력 (atm), 일정

  let temp = T_REF;      // 현재 온도 (K)

  function volumeFor(t) { return CONST * t; }          // 부피 = 상수 × T
  // 입자 속력(상댓값): 시각적으로 뚜렷이 보이도록 온도에 정비례시킨다.
  // (온도가 2배면 운동이 2배 활발해 보이도록 — 중학교 과정의 정성적 관계.
  //  부피도 T에 비례해 커지므로 '상자 가로지르는 시간'은 일정하고
  //  순간 속력만 또렷이 달라져, 상자 확대에 속력 변화가 가려지지 않는다.)
  function speedFactor(t) { return t / T_REF; }

  // ----- DOM -----
  const chamber = document.querySelector(".chamber");
  const gasEl = document.getElementById("gas");
  const pistonEl = document.getElementById("piston");
  const burnerEl = document.getElementById("burner");
  const thermoFill = document.getElementById("thermoFill");
  const tempSlider = document.getElementById("tempSlider");
  const resetBtn = document.getElementById("resetBtn");
  const tempVal = document.getElementById("tempVal");
  const volVal = document.getElementById("volVal");
  const vtVal = document.getElementById("vtVal");
  const presVal = document.getElementById("presVal");
  const speedFill = document.getElementById("speedFill");
  const speedVal = document.getElementById("speedVal");

  presVal.textContent = PRESSURE.toFixed(1);

  // ----- 입자 시뮬레이션 -----
  // 압력 일정 → 입자 개수 고정. 온도가 오르면 속력(√T)이 커지고,
  // 입자가 피스톤을 밀어 올려 부피가 커진다(공간이 넓어짐).
  const pCanvas = document.getElementById("particles");
  const pctx = pCanvas.getContext("2d");
  const N_PARTICLES = 30;
  const particles = [];
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let baseSpeed = 1.1;   // 기준 온도에서의 속력(px/frame), resize 시 보정

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
        vx: Math.cos(ang),   // 단위 방향벡터 (속력 크기는 온도가 결정)
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
    baseSpeed = 1.2 * dpr;
    const r = 4 * dpr;
    for (const p of particles) {
      if (p.x < r) p.x = r; else if (p.x > w * dpr - r) p.x = w * dpr - r;
      if (p.y < r) p.y = r; else if (p.y > h * dpr - r) p.y = h * dpr - r;
    }
  }

  // 온도에 따른 입자 색 (차가움: 하늘색 → 뜨거움: 빨강)
  function particleColor(t) {
    const k = (t - T_MIN) / (T_MAX - T_MIN); // 0..1
    const hue = 200 - k * 200; // 200(파랑) → 0(빨강)
    return `hsl(${hue}, 90%, ${60 + k * 8}%)`;
  }

  function drawParticles() {
    const w = pCanvas.width;
    const h = pCanvas.height;
    if (w === 0 || h === 0) return;
    pctx.clearRect(0, 0, w, h);
    const r = 4 * dpr;
    const speed = baseSpeed * speedFactor(temp);

    pctx.fillStyle = particleColor(temp);
    for (const p of particles) {
      p.x += p.vx * speed;
      p.y += p.vy * speed;

      if (p.x < r) { p.x = r; p.vx = Math.abs(p.vx); }
      else if (p.x > w - r) { p.x = w - r; p.vx = -Math.abs(p.vx); }
      if (p.y < r) { p.y = r; p.vy = Math.abs(p.vy); }
      else if (p.y > h - r) { p.y = h - r; p.vy = -Math.abs(p.vy); }

      pctx.beginPath();
      pctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      pctx.fill();
    }
  }

  // ----- V-T 그래프 -----
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

    // 원점(0K)부터 직선이 지나가는 모습을 보여주기 위해 X축 0부터 표시
    const Tmax = T_MAX;
    const Vmax = volumeFor(T_MAX);
    const xOf = (t) => padL + (t / Tmax) * plotW;
    const yOf = (v) => padT + (1 - v / Vmax) * plotH;

    // 격자
    gctx.strokeStyle = "rgba(201,168,136,0.18)";
    gctx.lineWidth = 1 * dpr;
    gctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const gy = padT + (plotH * i) / 4;
      gctx.moveTo(padL, gy); gctx.lineTo(w - padR, gy);
    }
    for (let i = 0; i <= 6; i++) {
      const gx = padL + (plotW * i) / 6;
      gctx.moveTo(gx, padT); gctx.lineTo(gx, h - padB);
    }
    gctx.stroke();

    // 축
    gctx.strokeStyle = "rgba(201,168,136,0.7)";
    gctx.lineWidth = 1.5 * dpr;
    gctx.beginPath();
    gctx.moveTo(padL, padT); gctx.lineTo(padL, h - padB);
    gctx.lineTo(w - padR, h - padB);
    gctx.stroke();

    // 직선 V = CONST·T (원점에서 출발 → 정비례)
    gctx.strokeStyle = "#fb923c";
    gctx.lineWidth = 2.5 * dpr;
    gctx.beginPath();
    gctx.moveTo(xOf(0), yOf(0));
    gctx.lineTo(xOf(Tmax), yOf(Vmax));
    gctx.stroke();

    // 측정 가능 범위(T_MIN~T_MAX) 강조
    gctx.strokeStyle = "rgba(251,146,60,0.35)";
    gctx.lineWidth = 7 * dpr;
    gctx.beginPath();
    gctx.moveTo(xOf(T_MIN), yOf(volumeFor(T_MIN)));
    gctx.lineTo(xOf(T_MAX), yOf(volumeFor(T_MAX)));
    gctx.stroke();

    // 현재 측정점
    const cx = xOf(temp), cy = yOf(volumeFor(temp));
    gctx.strokeStyle = "rgba(244,63,94,0.5)";
    gctx.setLineDash([4 * dpr, 4 * dpr]);
    gctx.lineWidth = 1.5 * dpr;
    gctx.beginPath();
    gctx.moveTo(cx, cy); gctx.lineTo(cx, h - padB);
    gctx.moveTo(cx, cy); gctx.lineTo(padL, cy);
    gctx.stroke();
    gctx.setLineDash([]);

    gctx.fillStyle = "#f43f5e";
    gctx.beginPath();
    gctx.arc(cx, cy, 6 * dpr, 0, Math.PI * 2);
    gctx.fill();
    gctx.strokeStyle = "#fff";
    gctx.lineWidth = 2 * dpr;
    gctx.stroke();

    // 축 라벨
    gctx.fillStyle = "rgba(201,168,136,0.9)";
    gctx.font = `${11 * dpr}px sans-serif`;
    gctx.textAlign = "center";
    gctx.fillText("절대온도 T (K)", padL + plotW / 2, h - 6 * dpr);
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
    const vol = volumeFor(temp);
    const frac = (vol - V_MIN) / (V_MAX - V_MIN); // 0..1
    const gasH = pistonH + frac * usable;
    const clamped = Math.max(pistonH + 4, Math.min(gasH, chamberH));
    gasEl.style.height = clamped + "px";
    pistonEl.style.bottom = (clamped - pistonH / 2) + "px";
  }

  function updateReadouts() {
    const vol = volumeFor(temp);
    const sf = speedFactor(temp);
    const k = (temp - T_MIN) / (T_MAX - T_MIN);

    tempVal.textContent = Math.round(temp);
    volVal.textContent = vol.toFixed(1);
    vtVal.textContent = (vol / temp).toFixed(4);
    speedVal.textContent = sf.toFixed(2);

    // 속력 막대: √(T_MIN/T_REF) ~ √(T_MAX/T_REF) 정규화
    const sMin = speedFactor(T_MIN), sMax = speedFactor(T_MAX);
    speedFill.style.width = ((sf - sMin) / (sMax - sMin) * 100) + "%";

    // 온도계 & 불꽃
    thermoFill.style.height = (k * 100) + "%";
    burnerEl.style.setProperty("--heat", k.toFixed(3));

    // 기체 색: 뜨거울수록 붉게
    const warm = 0.16 + k * 0.22;
    gasEl.style.background =
      `linear-gradient(180deg, rgba(251,146,60,${warm * 0.7}), rgba(251,146,60,${warm}))`;
  }

  function setTemp(t) {
    temp = Math.max(T_MIN, Math.min(T_MAX, t));
    tempSlider.value = Math.round(temp);
    layoutPiston();
    // 부피(공간 높이)가 바뀌므로 시뮬레이션 캔버스도 동기화
    sizeParticleCanvas();
    updateReadouts();
    drawGraph();
  }

  // ----- 슬라이더 -----
  tempSlider.addEventListener("input", function () {
    setTemp(parseFloat(this.value));
  });

  // ----- 초기화 -----
  resetBtn.addEventListener("click", function () {
    setTemp(T_REF);
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
  function loop() {
    drawParticles();
    requestAnimationFrame(loop);
  }

  // 초기 실행
  requestAnimationFrame(function () {
    onResize();
    setTemp(T_REF);
    loop();
  });
})();
