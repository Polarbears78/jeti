(function () {
  "use strict";

  // ----- 모형 설정 -----
  // 전압 일정 → I = V / R, 전류는 저항에 반비례 (I ∝ 1/R)
  const R_MIN = 1, R_MAX = 10;     // 저항 범위(Ω)
  const V_MIN = 2, V_MAX = 10;     // 전압 범위(V)
  const I_MAX = V_MAX / R_MIN;     // 전류축 최댓값 = 10 A
  const R_REF = 4, V_REF = 6;      // 기준값

  let res = R_REF;
  let volts = V_REF;
  function current() { return volts / res; }

  // ----- DOM -----
  const SVGNS = "http://www.w3.org/2000/svg";
  const wirePath = document.getElementById("wirePath");
  const electronsG = document.getElementById("electrons");
  const resZig = document.getElementById("resZig");
  const resTag = document.getElementById("resTag");
  const resSlider = document.getElementById("resSlider");
  const voltSlider = document.getElementById("voltSlider");
  const resetBtn = document.getElementById("resetBtn");
  const voltVal = document.getElementById("voltVal");
  const resVal = document.getElementById("resVal");
  const currVal = document.getElementById("currVal");

  // ----- 저항 지그재그 (저항이 클수록 굴곡이 많아짐) -----
  function drawResistor() {
    const x0 = 122, x1 = 198, cy = 50, amp = 7;
    const teeth = Math.max(4, res * 2);
    const pts = [`${x0},${cy}`];
    for (let i = 1; i <= teeth; i++) {
      const x = x0 + ((x1 - x0) * (i - 0.5)) / teeth;
      const y = cy + (i % 2 ? -amp : amp);
      pts.push(`${x.toFixed(1)},${y}`);
    }
    pts.push(`${x1},${cy}`);
    resZig.setAttribute("points", pts.join(" "));
    resTag.textContent = res;
  }

  // ----- 전류 입자(전자) 애니메이션 -----
  const N_DOTS = 16;
  const dots = [];
  let pathLen = 0;
  let phase = 0;

  function buildDots() {
    electronsG.textContent = "";
    dots.length = 0;
    for (let i = 0; i < N_DOTS; i++) {
      const c = document.createElementNS(SVGNS, "circle");
      c.setAttribute("r", "3.4");
      c.setAttribute("class", "electron");
      electronsG.appendChild(c);
      dots.push(c);
    }
  }

  function animateDots() {
    if (pathLen > 0) {
      const i = current();
      phase = (phase + i * 0.8) % pathLen;
      for (let k = 0; k < dots.length; k++) {
        const d = dots[k];
        const off = (phase + (pathLen * k) / N_DOTS) % pathLen;
        const p = wirePath.getPointAtLength(off);
        d.setAttribute("cx", p.x.toFixed(2));
        d.setAttribute("cy", p.y.toFixed(2));
      }
    }
    requestAnimationFrame(animateDots);
  }

  // ----- R-I 그래프 -----
  const gCanvas = document.getElementById("graph");
  const gctx = gCanvas.getContext("2d");
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let points = [];   // 현재 전압에서 측정한 (r, i) 점들

  function sizeGraph() {
    const w = gCanvas.clientWidth, h = gCanvas.clientHeight;
    gCanvas.width = w * dpr; gCanvas.height = h * dpr;
  }

  function recordPoint() {
    if (!points.some(p => p.r === res)) {
      points.push({ r: res, i: current() });
    }
  }

  function drawGraph() {
    const w = gCanvas.width, h = gCanvas.height;
    if (w === 0 || h === 0) return;
    gctx.clearRect(0, 0, w, h);

    const padL = 40 * dpr, padB = 28 * dpr, padT = 12 * dpr, padR = 12 * dpr;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const xOf = r => padL + (r / R_MAX) * plotW;
    const yOf = i => padT + (1 - i / I_MAX) * plotH;

    // 격자
    gctx.strokeStyle = "rgba(147,163,189,0.16)";
    gctx.lineWidth = 1 * dpr;
    gctx.beginPath();
    for (let k = 0; k <= 5; k++) {
      const gy = padT + (plotH * k) / 5;
      gctx.moveTo(padL, gy); gctx.lineTo(w - padR, gy);
    }
    for (let k = 0; k <= 5; k++) {
      const gx = padL + (plotW * k) / 5;
      gctx.moveTo(gx, padT); gctx.lineTo(gx, h - padB);
    }
    gctx.stroke();

    // 축
    gctx.strokeStyle = "rgba(147,163,189,0.7)";
    gctx.lineWidth = 1.5 * dpr;
    gctx.beginPath();
    gctx.moveTo(padL, padT); gctx.lineTo(padL, h - padB);
    gctx.lineTo(w - padR, h - padB);
    gctx.stroke();

    // 반비례 곡선 I = V / R (현재 전압 기준)
    gctx.strokeStyle = "#fb7185";
    gctx.lineWidth = 2.5 * dpr;
    gctx.beginPath();
    let started = false;
    for (let r = R_MIN; r <= R_MAX + 0.001; r += 0.1) {
      const iVal = Math.min(volts / r, I_MAX);
      const x = xOf(r), y = yOf(iVal);
      if (!started) { gctx.moveTo(x, y); started = true; }
      else gctx.lineTo(x, y);
    }
    gctx.stroke();

    // 측정점들
    gctx.fillStyle = "rgba(251,113,133,0.85)";
    for (const p of points) {
      gctx.beginPath();
      gctx.arc(xOf(p.r), yOf(Math.min(p.i, I_MAX)), 3.5 * dpr, 0, Math.PI * 2);
      gctx.fill();
    }

    // 현재 측정점(강조) + 보조선
    const cx = xOf(res), cy = yOf(Math.min(current(), I_MAX));
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
    gctx.fillStyle = "rgba(147,163,189,0.95)";
    gctx.font = `${11 * dpr}px sans-serif`;
    gctx.textAlign = "center";
    gctx.fillText("저항 R (Ω)", padL + plotW / 2, h - 6 * dpr);
    gctx.save();
    gctx.translate(12 * dpr, padT + plotH / 2);
    gctx.rotate(-Math.PI / 2);
    gctx.fillText("전류 I (A)", 0, 0);
    gctx.restore();
  }

  // ----- 측정값 -----
  function updateReadouts() {
    voltVal.textContent = volts.toFixed(1);
    resVal.textContent = res;
    currVal.textContent = current().toFixed(2);
  }

  function refresh() {
    drawResistor();
    updateReadouts();
    drawGraph();
  }

  // ----- 입력 -----
  resSlider.addEventListener("input", function () {
    res = parseInt(this.value, 10);
    recordPoint();
    refresh();
  });
  voltSlider.addEventListener("input", function () {
    volts = parseInt(this.value, 10);
    points = [];        // 전압(곡선)이 바뀌면 측정점 초기화
    recordPoint();
    refresh();
  });
  resetBtn.addEventListener("click", function () {
    res = R_REF; volts = V_REF;
    resSlider.value = res; voltSlider.value = volts;
    points = [];
    recordPoint();
    refresh();
  });

  // ----- 리사이즈 -----
  function onResize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    sizeGraph();
    drawGraph();
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", function () {
    setTimeout(onResize, 200);
  });

  // 초기 실행
  requestAnimationFrame(function () {
    buildDots();
    pathLen = wirePath.getTotalLength();
    onResize();
    recordPoint();
    refresh();
    animateDots();
  });
})();
