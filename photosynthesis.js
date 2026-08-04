(function () {
  "use strict";

  // ----- 광합성 모형 -----
  // 광합성량은 빛의 세기·CO₂ 농도·온도의 곱으로 결정되고,
  // 가장 부족한 조건(한정 요인)이 전체 광합성량을 제한한다.
  const BUBBLE_MAX = 60;   // 최적 조건에서의 최대 기포 발생 속도(개/분)
  const K_LIGHT = 20;      // 빛 반포화 상수(%)
  const K_CO2 = 25;        // CO₂ 반포화 상수(%)
  const T_OPT = 30;        // 최적 온도(℃)

  // 각 조건의 반응(0~1)
  function lightFactor(L) { return L / (L + K_LIGHT); }   // 포화 곡선
  function co2Factor(C) { return C / (C + K_CO2); }       // 포화 곡선
  function tempFactor(T) {
    // 최적 온도(30℃)에서 1, 낮으면 완만히·높으면(효소 변형) 급격히 감소
    const spread = T <= T_OPT ? 14 : 7;
    const z = (T - T_OPT) / spread;
    return Math.exp(-z * z);
  }

  // 광합성량(0~1): 세 요인의 곱
  function photoRate(L, C, T) {
    return lightFactor(L) * co2Factor(C) * tempFactor(T);
  }

  let light = 50;   // 빛의 세기(%)
  let co2 = 50;     // CO₂ 농도(%)
  let temp = 30;    // 온도(℃)

  // ----- DOM -----
  const scene = document.getElementById("scene");
  const waterEl = document.getElementById("water");
  const lightSlider = document.getElementById("lightSlider");
  const co2Slider = document.getElementById("co2Slider");
  const tempSlider = document.getElementById("tempSlider");
  const resetBtn = document.getElementById("resetBtn");
  const lightLabel = document.getElementById("lightLabel");
  const co2Label = document.getElementById("co2Label");
  const tempLabel = document.getElementById("tempLabel");
  const photoVal = document.getElementById("photoVal");
  const bubbleVal = document.getElementById("bubbleVal");
  const limitVal = document.getElementById("limitVal");
  const rateFill = document.getElementById("rateFill");
  const rateVal = document.getElementById("rateVal");

  // ----- 기포 시뮬레이션 -----
  const bCanvas = document.getElementById("bubbles");
  const bctx = bCanvas.getContext("2d");
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bubbles = [];
  let spawnAcc = 0;        // 기포 생성 누적치
  let currentRate = 0;     // 현재 기포 발생 속도(개/분)

  function sizeBubbleCanvas() {
    const w = waterEl.clientWidth;
    const h = waterEl.clientHeight;
    if (w === 0 || h === 0) return;
    bCanvas.width = w * dpr;
    bCanvas.height = h * dpr;
    bCanvas.style.width = w + "px";
    bCanvas.style.height = h + "px";
  }

  function spawnBubble() {
    const w = bCanvas.width;
    const h = bCanvas.height;
    if (w === 0 || h === 0) return;
    const r = (1.5 + Math.random() * 2.5) * dpr;
    bubbles.push({
      // 물풀 줄기(가운데 아래)에서 발생
      x: w / 2 + (Math.random() - 0.5) * 40 * dpr,
      y: h - (10 + Math.random() * 20) * dpr,
      r: r,
      vy: (0.6 + Math.random() * 0.7) * dpr,   // 위로 떠오르는 속도
      phase: Math.random() * Math.PI * 2,      // 좌우 흔들림 위상
      amp: (0.3 + Math.random() * 0.6) * dpr,  // 흔들림 크기
    });
  }

  function drawBubbles() {
    const w = bCanvas.width;
    const h = bCanvas.height;
    if (w === 0 || h === 0) return;
    bctx.clearRect(0, 0, w, h);

    // 광합성량에 비례해 기포 생성 (초당 currentRate/60 개, 60fps 가정)
    spawnAcc += currentRate / 60 / 60;
    while (spawnAcc >= 1) { spawnBubble(); spawnAcc -= 1; }

    bctx.lineWidth = 1 * dpr;
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.y -= b.vy;
      b.phase += 0.08;
      const bx = b.x + Math.sin(b.phase) * b.amp * 6;

      if (b.y + b.r < 0) { bubbles.splice(i, 1); continue; }

      bctx.beginPath();
      bctx.arc(bx, b.y, b.r, 0, Math.PI * 2);
      bctx.fillStyle = "rgba(224, 247, 255, 0.55)";
      bctx.fill();
      bctx.strokeStyle = "rgba(186, 230, 253, 0.9)";
      bctx.stroke();
      // 반짝임
      bctx.beginPath();
      bctx.arc(bx - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.3, 0, Math.PI * 2);
      bctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      bctx.fill();
    }
  }

  // ----- 광합성량-빛 그래프 -----
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

    const padL = 40 * dpr, padB = 26 * dpr, padT = 10 * dpr, padR = 12 * dpr;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    // Y축: 광합성량(개/분), 0~BUBBLE_MAX
    const xOf = (L) => padL + (L / 100) * plotW;
    const yOf = (p) => padT + (1 - p / BUBBLE_MAX) * plotH;

    // 격자
    gctx.strokeStyle = "rgba(143,189,160,0.16)";
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
    gctx.strokeStyle = "rgba(143,189,160,0.7)";
    gctx.lineWidth = 1.5 * dpr;
    gctx.beginPath();
    gctx.moveTo(padL, padT); gctx.lineTo(padL, h - padB);
    gctx.lineTo(w - padR, h - padB);
    gctx.stroke();

    // 현재 CO₂·온도에서의 광합성량-빛 곡선 (평평해지는 지점 = 한정)
    const cap = co2Factor(co2) * tempFactor(temp); // 빛 외 조건이 정한 상한
    gctx.strokeStyle = "#22c55e";
    gctx.lineWidth = 2.5 * dpr;
    gctx.beginPath();
    for (let L = 0; L <= 100; L += 2) {
      const p = BUBBLE_MAX * lightFactor(L) * cap;
      const px = xOf(L), py = yOf(p);
      if (L === 0) gctx.moveTo(px, py); else gctx.lineTo(px, py);
    }
    gctx.stroke();

    // 상한선(빛이 충분할 때 도달하는 최대) 점선
    const capY = yOf(BUBBLE_MAX * cap);
    gctx.strokeStyle = "rgba(34,197,94,0.35)";
    gctx.setLineDash([5 * dpr, 5 * dpr]);
    gctx.lineWidth = 1.5 * dpr;
    gctx.beginPath();
    gctx.moveTo(padL, capY); gctx.lineTo(w - padR, capY);
    gctx.stroke();
    gctx.setLineDash([]);

    // 현재 측정점
    const curP = BUBBLE_MAX * photoRate(light, co2, temp);
    const cx = xOf(light), cy = yOf(curP);
    gctx.strokeStyle = "rgba(56,189,248,0.5)";
    gctx.setLineDash([4 * dpr, 4 * dpr]);
    gctx.lineWidth = 1.5 * dpr;
    gctx.beginPath();
    gctx.moveTo(cx, cy); gctx.lineTo(cx, h - padB);
    gctx.moveTo(cx, cy); gctx.lineTo(padL, cy);
    gctx.stroke();
    gctx.setLineDash([]);

    gctx.fillStyle = "#38bdf8";
    gctx.beginPath();
    gctx.arc(cx, cy, 6 * dpr, 0, Math.PI * 2);
    gctx.fill();
    gctx.strokeStyle = "#fff";
    gctx.lineWidth = 2 * dpr;
    gctx.stroke();

    // 축 라벨
    gctx.fillStyle = "rgba(143,189,160,0.9)";
    gctx.font = `${11 * dpr}px sans-serif`;
    gctx.textAlign = "center";
    gctx.fillText("빛의 세기 (%)", padL + plotW / 2, h - 6 * dpr);
    gctx.save();
    gctx.translate(12 * dpr, padT + plotH / 2);
    gctx.rotate(-Math.PI / 2);
    gctx.fillText("광합성량 (개/분)", 0, 0);
    gctx.restore();
  }

  // ----- 화면 업데이트 -----
  function limitingFactor() {
    // 세 반응값 중 가장 작은 것이 한정 요인
    const fl = lightFactor(light);
    const fc = co2Factor(co2);
    const ft = tempFactor(temp);
    if (fl <= fc && fl <= ft) return "빛";
    if (fc <= fl && fc <= ft) return "CO₂";
    return "온도";
  }

  function updateReadouts() {
    const p = photoRate(light, co2, temp);   // 0~1
    currentRate = BUBBLE_MAX * p;

    photoVal.textContent = Math.round(p * 100);
    bubbleVal.textContent = Math.round(currentRate);
    rateVal.textContent = Math.round(currentRate);
    rateFill.style.width = (p * 100) + "%";
    limitVal.textContent = limitingFactor();

    lightLabel.textContent = Math.round(light);
    co2Label.textContent = Math.round(co2);
    tempLabel.textContent = Math.round(temp);

    // 전등 밝기·수조 밝기(빛의 세기 반영)
    scene.style.setProperty("--light", (light / 100).toFixed(3));
  }

  function update() {
    updateReadouts();
    drawGraph();
  }

  // ----- 슬라이더 -----
  lightSlider.addEventListener("input", function () { light = parseFloat(this.value); update(); });
  co2Slider.addEventListener("input", function () { co2 = parseFloat(this.value); update(); });
  tempSlider.addEventListener("input", function () { temp = parseFloat(this.value); update(); });

  // ----- 초기화 -----
  resetBtn.addEventListener("click", function () {
    light = 50; co2 = 50; temp = 30;
    lightSlider.value = 50; co2Slider.value = 50; tempSlider.value = 30;
    bubbles.length = 0; spawnAcc = 0;
    update();
  });

  // ----- 리사이즈 -----
  function onResize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    sizeBubbleCanvas();
    sizeGraph();
    drawGraph();
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", function () {
    setTimeout(onResize, 200);
  });

  // ----- 애니메이션 루프 -----
  function loop() {
    drawBubbles();
    requestAnimationFrame(loop);
  }

  // 초기 실행
  requestAnimationFrame(function () {
    onResize();
    update();
    loop();
  });
})();
