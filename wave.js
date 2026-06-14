(function () {
  "use strict";

  // ----- 모형 설정 -----
  // 소리의 세기 ∝ 진폭(amplitude), 소리의 높이 ∝ 진동수(frequency).
  // 오실로스코프 화면에 사인 파형으로 표시하고, 실제 소리도 함께 재생한다.
  const AMP_REF = 60;        // 기준 세기(%)
  const FREQ_REF = 300;      // 기준 진동수(Hz)
  const FREQ_MIN = 100;
  const FREQ_MAX = 800;
  const SOUND_SPEED = 340;   // 소리의 속력(m/s)
  const MAX_GAIN = 0.18;     // 오디오 최대 음량(귀 보호용)

  let amp = AMP_REF;         // 세기(%)
  let freq = FREQ_REF;       // 진동수(Hz)

  // ----- DOM -----
  const ampSlider = document.getElementById("ampSlider");
  const freqSlider = document.getElementById("freqSlider");
  const resetBtn = document.getElementById("resetBtn");
  const playBtn = document.getElementById("playBtn");
  const playText = playBtn.querySelector(".play-text");
  const ampVal = document.getElementById("ampVal");
  const freqVal = document.getElementById("freqVal");
  const periodVal = document.getElementById("periodVal");
  const waveVal = document.getElementById("waveVal");

  // ----- 캔버스 -----
  const canvas = document.getElementById("scope");
  const ctx = canvas.getContext("2d");
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let phase = 0;             // 파형 스크롤 위상

  function sizeCanvas() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }

  // 화면에 보이는 파동의 수 (진동수가 클수록 촘촘) — 100Hz당 1개
  function cyclesOnScreen() { return freq / 100; }

  function drawGrid(w, h) {
    ctx.strokeStyle = "rgba(34,197,94,0.14)";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    const cols = 10, rows = 6;
    for (let i = 1; i < cols; i++) {
      const x = (w * i) / cols;
      ctx.moveTo(x, 0); ctx.lineTo(x, h);
    }
    for (let j = 1; j < rows; j++) {
      const y = (h * j) / rows;
      ctx.moveTo(0, y); ctx.lineTo(w, y);
    }
    ctx.stroke();

    // 중심축
    ctx.strokeStyle = "rgba(34,197,94,0.35)";
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.stroke();
  }

  function drawTrace(w, h) {
    const cycles = cyclesOnScreen();
    const ampPx = (amp / 100) * (h / 2 - 10 * dpr); // 진폭(픽셀)
    const k = (Math.PI * 2 * cycles) / w;           // 화면 가로에 cycles개

    // 잔광(글로우) 효과
    ctx.lineWidth = 5 * dpr;
    ctx.strokeStyle = "rgba(34,197,94,0.18)";
    tracePath(w, h, ampPx, k);
    ctx.stroke();

    // 선명한 트레이스
    ctx.lineWidth = 2.4 * dpr;
    ctx.strokeStyle = "#34f07f";
    ctx.shadowColor = "rgba(52,240,127,0.8)";
    ctx.shadowBlur = 8 * dpr;
    tracePath(w, h, ampPx, k);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function tracePath(w, h, ampPx, k) {
    ctx.beginPath();
    const cy = h / 2;
    for (let x = 0; x <= w; x += 1 * dpr) {
      const y = cy - ampPx * Math.sin(k * x + phase);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  function draw() {
    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return;
    ctx.clearRect(0, 0, w, h);
    drawGrid(w, h);
    drawTrace(w, h);
    phase += 0.08;            // 살아 있는 화면처럼 스크롤
    requestAnimationFrame(draw);
  }

  // ----- Web Audio (실제 소리) -----
  let audioCtx = null, osc = null, gainNode = null, playing = false;

  function ampToGain() { return (amp / 100) * MAX_GAIN; }

  function startSound() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    osc = audioCtx.createOscillator();
    gainNode = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gainNode.gain.value = ampToGain();
    osc.connect(gainNode).connect(audioCtx.destination);
    osc.start();
    playing = true;
    applyPlayState();
  }

  function stopSound() {
    if (osc) { try { osc.stop(); } catch (e) {} osc.disconnect(); osc = null; }
    if (gainNode) { gainNode.disconnect(); gainNode = null; }
    playing = false;
    applyPlayState();
  }

  function applyPlayState() {
    playBtn.classList.toggle("on", playing);
    playBtn.classList.toggle("off", !playing);
    playBtn.setAttribute("aria-pressed", playing ? "true" : "false");
    playText.textContent = playing ? "소리 멈춤" : "소리 듣기";
    playBtn.querySelector(".play-ico").textContent = playing ? "■" : "▶";
  }

  function syncAudioParams() {
    if (playing && osc && gainNode && audioCtx) {
      const t = audioCtx.currentTime;
      osc.frequency.setTargetAtTime(freq, t, 0.01);
      gainNode.gain.setTargetAtTime(ampToGain(), t, 0.01);
    }
  }

  // ----- 측정값 -----
  function updateReadouts() {
    ampVal.textContent = amp;
    freqVal.textContent = freq;
    periodVal.textContent = (1000 / freq).toFixed(1);     // 주기 T(ms)
    waveVal.textContent = (SOUND_SPEED / freq).toFixed(2); // 파장 λ(m)
  }

  // ----- 입력 -----
  ampSlider.addEventListener("input", function () {
    amp = parseInt(this.value, 10);
    updateReadouts();
    syncAudioParams();
  });
  freqSlider.addEventListener("input", function () {
    freq = parseInt(this.value, 10);
    updateReadouts();
    syncAudioParams();
  });
  playBtn.addEventListener("click", function () {
    if (playing) stopSound(); else startSound();
  });
  resetBtn.addEventListener("click", function () {
    amp = AMP_REF; freq = FREQ_REF;
    ampSlider.value = amp; freqSlider.value = freq;
    updateReadouts();
    syncAudioParams();
  });

  // 페이지를 떠나거나 숨길 때 소리 정지
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && playing) stopSound();
  });

  // ----- 리사이즈 -----
  function onResize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    sizeCanvas();
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", function () {
    setTimeout(onResize, 200);
  });

  // 초기 실행
  requestAnimationFrame(function () {
    onResize();
    updateReadouts();
    applyPlayState();
    draw();
  });
})();
