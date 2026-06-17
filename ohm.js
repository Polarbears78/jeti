(function () {
  "use strict";

  // ----- 모형 설정 -----
  // 옴의 법칙: V = I × R  →  I = V / R (저항 일정 시 전류는 전압에 정비례)
  const V_MIN = 0, V_MAX = 10;     // 전압 범위(V)
  const R_MIN = 2, R_MAX = 10;     // 저항 범위(Ω)
  const I_MAX = V_MAX / R_MIN;     // 그래프 전류축 최댓값 = 5 A
  const V_REF = 4, R_REF = 4;      // 기준값

  let volts = V_REF;
  let res = R_REF;
  function current() { return volts / res; }

  // ----- DOM -----
  const SVGNS = "http://www.w3.org/2000/svg";
  const wirePath = document.getElementById("wirePath");
  const electronsG = document.getElementById("electrons");
  const voltSlider = document.getElementById("voltSlider");
  const resSlider = document.getElementById("resSlider");
  const resetBtn = document.getElementById("resetBtn");
  const voltVal = document.getElementById("voltVal");
  const resVal = document.getElementById("resVal");
  const currVal = document.getElementById("currVal");

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
      const visible = i > 0.001;
      for (let k = 0; k < dots.length; k++) {
        const d = dots[k];
        if (!visible) { d.setAttribute("opacity", "0.12"); continue; }
        d.setAttribute("opacity", "1");
        const off = (phase + (pathLen * k) / N_DOTS) % pathLen;
        const p = wirePath.getPointAtLength(off);
        d.setAttribute("cx", p.x.toFixed(2));
        d.setAttribute("cy", p.y.toFixed(2));
      }
    }
    requestAnimationFrame(animateDots);
  }

  // ----- V-I 그래프 -----
  const gCanvas = document.getElementById("graph");
  const gctx = gCanvas.getContext("2d");
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let points = [];   // 현재 저항에서 측정한 (v, i) 점들

  function sizeGraph() {
    const w = gCanvas.clientWidth, h = gCanvas.clientHeight;
    gCanvas.width = w * dpr; gCanvas.height = h * dpr;
  }

  function recordPoint() {
    if (volts <= 0) return;
    if (!points.some(p => Math.abs(p.v - volts) < 1e-6)) {
      points.push({ v: volts, i: current() });
    }
  }

  function drawGraph() {
    const w = gCanvas.width, h = gCanvas.height;
    if (w === 0 || h === 0) return;
    gctx.clearRect(0, 0, w, h);

    const padL = 40 * dpr, padB = 28 * dpr, padT = 12 * dpr, padR = 12 * dpr;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const xOf = v => padL + (v / V_MAX) * plotW;
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

    // 직선 I = V / R (원점 지나는 정비례) — 현재 저항 기준
    const iAtMax = Math.min(V_MAX / res, I_MAX);
    const vAtCap = iAtMax * res; // 전류축에서 잘릴 경우의 전압
    gctx.strokeStyle = "#38bdf8";
    gctx.lineWidth = 2.5 * dpr;
    gctx.beginPath();
    gctx.moveTo(xOf(0), yOf(0));
    gctx.lineTo(xOf(vAtCap), yOf(iAtMax));
    gctx.stroke();

    // 측정점들
    gctx.fillStyle = "rgba(245,158,11,0.85)";
    for (const p of points) {
      gctx.beginPath();
      gctx.arc(xOf(p.v), yOf(Math.min(p.i, I_MAX)), 3.5 * dpr, 0, Math.PI * 2);
      gctx.fill();
    }

    // 현재 측정점(강조) + 보조선
    const cx = xOf(volts), cy = yOf(Math.min(current(), I_MAX));
    gctx.strokeStyle = "rgba(245,158,11,0.45)";
    gctx.setLineDash([4 * dpr, 4 * dpr]);
    gctx.lineWidth = 1.5 * dpr;
    gctx.beginPath();
    gctx.moveTo(cx, cy); gctx.lineTo(cx, h - padB);
    gctx.moveTo(cx, cy); gctx.lineTo(padL, cy);
    gctx.stroke();
    gctx.setLineDash([]);

    gctx.fillStyle = "#f59e0b";
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
    gctx.fillText("전압 V (V)", padL + plotW / 2, h - 6 * dpr);
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
    updateReadouts();
    drawGraph();
  }

  // ----- 입력 -----
  voltSlider.addEventListener("input", function () {
    volts = parseFloat(this.value);
    recordPoint();
    refresh();
  });
  resSlider.addEventListener("input", function () {
    res = parseInt(this.value, 10);
    points = [];        // 저항(기울기)이 바뀌면 측정점 초기화
    recordPoint();
    refresh();
  });
  resetBtn.addEventListener("click", function () {
    volts = V_REF; res = R_REF;
    voltSlider.value = volts; resSlider.value = res;
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
