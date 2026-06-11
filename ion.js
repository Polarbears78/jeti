(function () {
  "use strict";

  // ----- 모형 설정 -----
  // 전해질 수용액 속 양이온(+)과 음이온(−)이 전류를 흘려 줄 때 전극으로 이동.
  //   양이온(+) → 음극(−, 왼쪽)   /   음이온(−) → 양극(+, 오른쪽)
  // 전류가 없으면 이온은 무질서하게(열운동) 떠다닌다.
  const N_CATION = 12;        // 양이온 수
  const N_ANION = 12;         // 음이온 수
  const V_REF = 3.0;          // 기준 전압 (V)
  const V_MAX = 6.0;          // 최대 전압 (V)

  let voltage = V_REF;        // 현재 전압 (V)
  let powerOn = false;        // 전류 흐름 여부
  let arrived = 0;            // 전극에 도달한 이온 누적 수

  // ----- DOM -----
  const solutionEl = document.getElementById("solution");
  const cathodeEl = document.getElementById("cathode");
  const anodeEl = document.getElementById("anode");
  const powerBtn = document.getElementById("powerBtn");
  const powerText = powerBtn.querySelector(".power-text");
  const voltSlider = document.getElementById("voltSlider");
  const resetBtn = document.getElementById("resetBtn");
  const voltVal = document.getElementById("voltVal");
  const currVal = document.getElementById("currVal");
  const arriveVal = document.getElementById("arriveVal");

  // ----- 캔버스 -----
  const canvas = document.getElementById("ions");
  const ctx = canvas.getContext("2d");
  const ions = [];
  const flashes = [];        // 전극 도달 순간의 섬광 효과
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let THERMAL = 0.7;         // 열운동 속력(px/frame) — 무질서한 움직임
  let R = 6;                 // 이온 반지름(px)

  function rand(min, max) { return min + Math.random() * (max - min); }

  // 이온 1개 생성 (charge: +1 양이온 / -1 음이온)
  function makeIon(charge) {
    const w = canvas.width || 200;
    const h = canvas.height || 200;
    const ang = Math.random() * Math.PI * 2;
    return {
      charge: charge,
      x: rand(R * 2, w - R * 2),
      y: rand(R * 2, h - R * 2),
      tvx: Math.cos(ang),   // 열운동 방향(단위 벡터)
      tvy: Math.sin(ang),
    };
  }

  function buildIons() {
    ions.length = 0;
    for (let i = 0; i < N_CATION; i++) ions.push(makeIon(+1));
    for (let i = 0; i < N_ANION; i++) ions.push(makeIon(-1));
  }

  // 도달 후 가운데 부근에서 다시 등장 (전류가 계속 흐르는 모습)
  function respawn(p) {
    const w = canvas.width;
    const h = canvas.height;
    p.x = rand(w * 0.38, w * 0.62);
    p.y = rand(R * 2, h - R * 2);
    const ang = Math.random() * Math.PI * 2;
    p.tvx = Math.cos(ang);
    p.tvy = Math.sin(ang);
  }

  function sizeCanvas() {
    const w = solutionEl.clientWidth;
    const h = solutionEl.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    THERMAL = 0.7 * dpr;
    R = 6 * dpr;
    for (const p of ions) {
      p.x = Math.max(R, Math.min(p.x, canvas.width - R));
      p.y = Math.max(R, Math.min(p.y, canvas.height - R));
    }
  }

  // ----- 한 프레임 갱신 -----
  function step() {
    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return;
    ctx.clearRect(0, 0, w, h);

    // 전압이 클수록 전극 쪽으로 끌리는 속도(드리프트)가 커진다
    const drift = powerOn ? (voltage / V_MAX) * 2.6 * dpr : 0;

    for (const p of ions) {
      // 양이온(+)은 왼쪽(음극)으로, 음이온(−)은 오른쪽(양극)으로 끌린다
      const pull = p.charge > 0 ? -drift : drift;

      p.x += p.tvx * THERMAL + pull;
      p.y += p.tvy * THERMAL;

      // 위/아래 벽: 항상 반사
      if (p.y < R) { p.y = R; p.tvy = Math.abs(p.tvy); }
      else if (p.y > h - R) { p.y = h - R; p.tvy = -Math.abs(p.tvy); }

      // 왼쪽 벽(음극): 양이온은 도달, 음이온은 반사
      if (p.x < R) {
        if (powerOn && p.charge > 0) { arrive(p, R, p.y); }
        else { p.x = R; p.tvx = Math.abs(p.tvx); }
      }
      // 오른쪽 벽(양극): 음이온은 도달, 양이온은 반사
      else if (p.x > w - R) {
        if (powerOn && p.charge < 0) { arrive(p, w - R, p.y); }
        else { p.x = w - R; p.tvx = -Math.abs(p.tvx); }
      }

      drawIon(p);
    }

    drawFlashes();
  }

  function arrive(p, fx, fy) {
    arrived++;
    arriveVal.textContent = arrived;
    flashes.push({ x: fx, y: fy, charge: p.charge, age: 0 });
    respawn(p);
  }

  function drawIon(p) {
    const cation = p.charge > 0;
    const color = cation ? "#f87171" : "#60a5fa";
    ctx.beginPath();
    ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    // + / − 기호
    ctx.fillStyle = "rgba(11,16,38,0.92)";
    ctx.font = `bold ${R * 1.4}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(cation ? "+" : "−", p.x, p.y + (cation ? 0 : -R * 0.05));
  }

  function drawFlashes() {
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.age += 1;
      const t = f.age / 18;          // 0 → 1
      if (t >= 1) { flashes.splice(i, 1); continue; }
      const rad = R + t * R * 3;
      ctx.beginPath();
      ctx.arc(f.x, f.y, rad, 0, Math.PI * 2);
      ctx.strokeStyle = f.charge > 0
        ? `rgba(248,113,113,${1 - t})`
        : `rgba(96,165,250,${1 - t})`;
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
    }
  }

  // ----- 화면/상태 갱신 -----
  function updateReadouts() {
    voltVal.textContent = voltage.toFixed(1);
    // 전류는 전압에 비례 (전류가 흐를 때만). 모형용 임의 환산: I ≈ 40·V mA
    const current = powerOn ? Math.round(voltage * 40) : 0;
    currVal.textContent = current;
  }

  function applyPowerState() {
    powerBtn.classList.toggle("on", powerOn);
    powerBtn.classList.toggle("off", !powerOn);
    powerBtn.setAttribute("aria-pressed", powerOn ? "true" : "false");
    powerText.textContent = powerOn ? "전류 ON" : "전류 OFF";
    cathodeEl.classList.toggle("live", powerOn);
    anodeEl.classList.toggle("live", powerOn);
    updateReadouts();
  }

  // ----- 입력 -----
  powerBtn.addEventListener("click", function () {
    powerOn = !powerOn;
    applyPowerState();
  });
  voltSlider.addEventListener("input", function () {
    voltage = parseFloat(this.value);
    updateReadouts();
  });
  resetBtn.addEventListener("click", function () {
    powerOn = false;
    voltage = V_REF;
    voltSlider.value = V_REF;
    arrived = 0;
    arriveVal.textContent = "0";
    buildIons();
    sizeCanvas();
    applyPowerState();
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

  // ----- 애니메이션 루프 -----
  function loop() {
    step();
    requestAnimationFrame(loop);
  }

  // 초기 실행
  requestAnimationFrame(function () {
    buildIons();
    onResize();
    applyPowerState();
    loop();
  });
})();
