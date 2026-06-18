# Pico 2 W 방수 온도센서 웹서버 (DS18B20)

Raspberry Pi **Pico 2 W**에 **방수 온도센서(DS18B20)** 를 연결하고,
Pico 자체를 **WiFi 웹서버**로 띄워서 스마트폰·PC 브라우저로 접속합니다.
웹페이지에서 **▶ 시작** 을 누르면 온도를 1초마다 기록하고, **■ 정지** 를 누르면
멈춘 뒤 데이터를 **CSV 파일**로 내려받을 수 있습니다.

> 인터넷이나 별도 PC 프로그램이 필요 없습니다. Pico와 폰/PC가 **같은 WiFi**에만
> 연결되어 있으면 됩니다.

---

## 1. 준비물

- Raspberry Pi **Pico 2 W** (WiFi 모델, 2.4GHz)
- **방수형 DS18B20** 온도센서 (보통 빨강=VCC, 검정=GND, 노랑/흰색=DATA 3선)
- **4.7kΩ 저항** 1개 (풀업용, 필수)
- 점퍼선 · 브레드보드

## 2. 배선 (DS18B20 → Pico)

| DS18B20 선 | 연결 위치 (Pico) |
|---|---|
| 빨강 (VCC)  | **3V3 (OUT)** — 36번 핀 |
| 검정 (GND)  | **GND** (예: 38번 핀) |
| 노랑 (DATA) | **GP15** (20번 핀) |

➕ **풀업 저항**: DATA(노랑)와 VCC(빨강) 사이에 **4.7kΩ 저항**을 연결합니다.
이 저항이 없으면 센서값을 못 읽습니다.

```
 3V3 ──┬──────────── 빨강(VCC)
       │
      4.7kΩ
       │
GP15 ──┴──────────── 노랑(DATA)
 GND ─────────────── 검정(GND)
```

> 데이터선 핀을 바꾸고 싶으면 `config.py`의 `SENSOR_PIN` 값을 수정하세요.

## 3. 펌웨어 설치 (최초 1회)

1. Pico의 **BOOTSEL** 버튼을 누른 채 USB로 PC에 연결합니다.
2. [MicroPython 공식 사이트](https://micropython.org/download/)에서
   **Raspberry Pi Pico 2 W** 용 `.uf2` 펌웨어를 받아, 나타난 USB 드라이브에 복사합니다.
3. Pico가 자동으로 재부팅되면 MicroPython 준비 완료입니다.

## 4. WiFi 정보 입력 (필수)

`config.py`를 열어 **WiFi 이름/비밀번호**를 본인 것으로 입력하고 저장하세요.
보드 이름은 기본값 `temp-01`로 설정되어 있습니다(`HOSTNAME`).

```python
WIFI_SSID = "우리집_와이파이"
WIFI_PASSWORD = "비밀번호"
HOSTNAME = "temp-01"
```

## 5. 파일 올리기

### 방법 A — 명령어 한 줄 (권장, 자동 업로드)

Pico가 USB로 연결된 **본인 컴퓨터**에서 이 `pico/` 폴더로 이동한 뒤:

- **macOS / Linux**: `bash upload.sh`
- **Windows**: `upload.bat` 더블클릭 (또는 명령창에서 `upload.bat`)

스크립트가 업로드 도구(`mpremote`)를 설치하고 `config.py`·`web.html`·`main.py`를
보드에 올린 뒤 자동으로 재부팅합니다. (Python 3 설치 필요)

### 방법 B — Thonny (그래픽 편집기)

1. [Thonny](https://thonny.org/) 설치 후, 우하단 인터프리터를 **MicroPython (Raspberry Pi Pico)** 로 선택.
2. 이 폴더의 **세 파일을 모두 Pico에 저장**(파일 우클릭 → *Upload to /*):
   `main.py`, `web.html`, `config.py`

## 6. 실행 & 접속

1. Pico를 USB 또는 보조배터리로 켜면 `main.py`가 자동 실행됩니다.
2. (Thonny) **Shell 창**에 접속 주소가 출력됩니다:
   ```
   WiFi 연결 완료! 브라우저에서 접속:
      http://192.168.0.42
      http://temp-01.local  (mDNS 지원 기기)
   웹서버 시작. http://192.168.0.42 로 접속하세요.
   ```
3. **같은 WiFi**에 연결된 스마트폰/PC 브라우저에서 접속:
   - **`http://temp-01.local`** (아이폰·맥·최신 안드로이드/윈도우에서 지원)
   - 위 주소가 안 되면 출력된 IP(`http://192.168.x.x`)로 접속
4. **▶ 시작** → 온도 기록 시작, **■ 정지** → 기록 종료,
   **💾 CSV 파일로 저장** → 측정 데이터(.csv) 다운로드.

---

## 동작 방식

```
pico/
├── main.py     # WiFi 접속 + DS18B20 읽기 + HTTP 서버 (제어 페이지·/temp JSON 제공)
├── web.html    # 브라우저 제어 페이지 (시작/정지/CSV 저장 + 실시간 그래프)
├── config.py   # WiFi 정보, 보드 이름(temp-01), 센서 GPIO 핀, 측정 간격 설정
├── upload.sh   # (macOS/Linux) 자동 업로드 스크립트
└── upload.bat  # (Windows) 자동 업로드 스크립트
```

> `upload.sh`/`upload.bat`은 보드에 올리는 파일이 아니라, **본인 컴퓨터에서 실행**하는 업로드 도구입니다.

- 브라우저가 `http://<Pico-IP>/` 로 접속하면 Pico가 `web.html`을 보냅니다.
- 페이지는 1초마다 `GET /temp` 를 호출하고, Pico는 최신 온도를 JSON으로 응답합니다.
  ```json
  {"ok": true, "temp": 23.5625, "t": 18423, "sensor": true}
  ```
- DS18B20는 온도 변환에 ~0.75초가 걸리므로, `main.py`는 변환을 미리 걸어 두고
  결과만 읽는 방식(논블로킹)으로 서버가 멈추지 않게 합니다.
- 측정 데이터는 브라우저가 모았다가 정지 후 CSV(BOM 포함, 엑셀 한글 호환)로 저장합니다.

## 문제 해결

- **"센서를 찾지 못했습니다"**: 4.7kΩ 풀업 저항, DATA 핀(GP15), VCC/GND 배선을 확인하세요.
- **"Pico 서버에 연결할 수 없습니다"**: 폰/PC와 Pico가 같은 WiFi(2.4GHz)인지, 주소가 맞는지 확인하세요.
- **`temp-01.local` 접속이 안 됨**: 일부 공유기/기기는 mDNS를 막습니다. 이 경우 출력된 IP(`http://192.168.x.x`)로 접속하세요.
- **`upload.sh`에서 보드를 못 찾음**: USB 케이블이 데이터 전송용인지, Pico에 MicroPython 펌웨어가 설치됐는지(3번 항목) 확인하세요.
- **WiFi LED가 빠르게 깜빡임**: WiFi 접속 실패 → `config.py`의 SSID/비밀번호를 확인하세요.
- 측정 간격을 바꾸려면 `config.py`의 `SAMPLE_INTERVAL_MS`와 `web.html`의 `INTERVAL`을 같은 값으로 맞추세요.
