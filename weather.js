(function () {
  "use strict";

  // 위치 센서(GPS)로 좌표를 얻고, 그 지점의 실시간 관측값을
  // Open-Meteo(무료·키 불필요)에서 받아 표시한다.
  // 브라우저는 기압·온도·습도 센서를 웹에 직접 노출하지 않는다.

  const FALLBACK = { lat: 37.5665, lon: 126.978, name: "서울(기본 위치)" };

  // 게이지 범위
  const P_LO = 950, P_HI = 1050;    // hPa
  const T_LO = -20, T_HI = 40;      // °C
  const STD_P = 1013.25;

  // ----- DOM -----
  const measureBtn = document.getElementById("measureBtn");
  const locName = document.getElementById("locName");
  const obsTime = document.getElementById("obsTime");
  const statusMsg = document.getElementById("statusMsg");
  const presVal = document.getElementById("presVal");
  const presFill = document.getElementById("presFill");
  const presNote = document.getElementById("presNote");
  const tempVal = document.getElementById("tempVal");
  const tempFill = document.getElementById("tempFill");
  const tempNote = document.getElementById("tempNote");
  const humidVal = document.getElementById("humidVal");
  const humidFill = document.getElementById("humidFill");
  const humidNote = document.getElementById("humidNote");
  const dewVal = document.getElementById("dewVal");
  const mslVal = document.getElementById("mslVal");
  const feelVal = document.getElementById("feelVal");

  function setStatus(msg, isError) {
    statusMsg.textContent = msg || "";
    statusMsg.classList.toggle("error", !!isError);
  }

  function pct(v, lo, hi) {
    return Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  }

  // 이슬점 (Magnus 공식)
  function dewPoint(t, rh) {
    const a = 17.62, b = 243.12;
    const gamma = Math.log(rh / 100) + (a * t) / (b + t);
    return (b * gamma) / (a - gamma);
  }

  // ----- 위치 얻기 (GPS 센서) -----
  function getPosition() {
    return new Promise(function (resolve) {
      if (!("geolocation" in navigator)) {
        setStatus("이 기기는 위치 기능을 지원하지 않아 기본 위치(서울)로 측정합니다.", true);
        resolve(FALLBACK);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          resolve({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            name: null,
          });
        },
        function (err) {
          const why = err.code === 1
            ? "위치 권한이 거부되어"
            : "위치를 확인하지 못해";
          setStatus(why + " 기본 위치(서울) 값으로 측정합니다. 브라우저 설정에서 위치를 허용하면 내 위치로 측정돼요.", true);
          resolve(FALLBACK);
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
      );
    });
  }

  // ----- 지명 알아내기 (역지오코딩, 실패해도 무시) -----
  async function placeName(lat, lon) {
    try {
      const r = await fetch(
        "https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=" +
        lat + "&longitude=" + lon + "&localityLanguage=ko"
      );
      const d = await r.json();
      const parts = [d.principalSubdivision, d.city || d.locality].filter(Boolean);
      return parts.length ? parts.join(" ") : null;
    } catch (e) {
      return null;
    }
  }

  // ----- 관측값 가져오기 -----
  async function fetchWeather(lat, lon) {
    const url =
      "https://api.open-meteo.com/v1/forecast?latitude=" + lat +
      "&longitude=" + lon +
      "&current=temperature_2m,relative_humidity_2m,surface_pressure,pressure_msl,apparent_temperature" +
      "&timezone=auto";
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    return d.current;
  }

  // ----- 화면 표시 -----
  function render(cur) {
    const p = cur.surface_pressure;
    const t = cur.temperature_2m;
    const h = cur.relative_humidity_2m;

    presVal.textContent = p.toFixed(1);
    presFill.style.width = pct(p, P_LO, P_HI) + "%";
    const dp = p - STD_P;
    presNote.textContent = dp >= 0
      ? "표준 기압보다 " + dp.toFixed(1) + " hPa 높아요 (고기압 쪽)"
      : "표준 기압보다 " + Math.abs(dp).toFixed(1) + " hPa 낮아요 (저기압 쪽)";

    tempVal.textContent = t.toFixed(1);
    tempFill.style.width = pct(t, T_LO, T_HI) + "%";
    tempNote.textContent =
      t >= 33 ? "매우 더워요 — 입자 운동이 아주 활발!" :
      t >= 25 ? "더운 편이에요" :
      t >= 15 ? "활동하기 좋은 온도예요" :
      t >= 5  ? "쌀쌀해요" :
                "추워요 — 입자 운동이 느려져요";

    humidVal.textContent = Math.round(h);
    humidFill.style.width = pct(h, 0, 100) + "%";
    humidNote.textContent =
      h >= 80 ? "매우 습해요 — 수증기 입자가 많아요" :
      h >= 60 ? "습한 편이에요" :
      h >= 40 ? "쾌적한 습도예요" :
                "건조해요 — 수증기 입자가 적어요";

    dewVal.textContent = dewPoint(t, h).toFixed(1);
    mslVal.textContent = cur.pressure_msl != null ? cur.pressure_msl.toFixed(1) : "--";
    feelVal.textContent = cur.apparent_temperature != null ? cur.apparent_temperature.toFixed(1) : "--";

    const when = cur.time ? cur.time.replace("T", " ") : "";
    obsTime.textContent = "관측 시각 " + when + " · 새로고침하려면 다시 누르세요";
  }

  // ----- 측정 실행 -----
  async function measure() {
    measureBtn.disabled = true;
    measureBtn.textContent = "측정 중…";
    setStatus("");
    locName.textContent = "위치 확인 중…";
    try {
      const pos = await getPosition();
      locName.textContent = pos.name || ("위도 " + pos.lat.toFixed(3) + ", 경도 " + pos.lon.toFixed(3));

      // 지명과 관측값을 동시에 요청
      const [name, cur] = await Promise.all([
        pos.name ? Promise.resolve(pos.name) : placeName(pos.lat, pos.lon),
        fetchWeather(pos.lat, pos.lon),
      ]);
      if (name) locName.textContent = name;
      render(cur);
    } catch (e) {
      setStatus("관측값을 가져오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요. (" + e.message + ")", true);
      obsTime.textContent = "측정 실패";
    } finally {
      measureBtn.disabled = false;
      measureBtn.textContent = "다시 측정";
    }
  }

  measureBtn.addEventListener("click", measure);
})();
