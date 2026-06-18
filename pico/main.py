# Raspberry Pi Pico 2 W + DS18B20 방수 온도센서 웹서버
# - WiFi에 접속해 웹서버를 띄우고, 브라우저에서 제어 페이지(web.html)를 엽니다.
# - 페이지의 '시작'을 누르면 /temp 를 주기적으로 호출해 온도를 받아오고,
#   '정지'를 누르면 멈춘 뒤 CSV 파일로 저장할 수 있습니다.
#
# 필요한 모듈(machine, network, onewire, ds18x20, socket 등)은 모두
# MicroPython 펌웨어에 기본 포함되어 있습니다.

import network
import socket
import time
import machine
import onewire
import ds18x20
import select

import config

# ---------- DS18B20 온도센서 ----------
class TempSensor:
    """DS18B20를 논블로킹으로 읽기 위한 도우미.

    DS18B20는 온도 변환에 약 0.75초가 걸린다. 그래서 '변환 시작 → 잠시 뒤 읽기'를
    분리해, 변환을 걸어 두고 다음 주기에 결과만 읽는 방식으로 서버가 멈추지 않게 한다.
    """

    CONVERT_MS = 800  # 변환 대기 여유 시간

    def __init__(self, pin_num):
        self.ow = onewire.OneWire(machine.Pin(pin_num))
        self.ds = ds18x20.DS18X20(self.ow)
        self.roms = self.ds.scan()
        self.last_temp = None      # 마지막으로 읽은 온도(섭씨)
        self._converting = False
        self._convert_at = 0
        if self.roms:
            self._start_convert()

    @property
    def found(self):
        return len(self.roms) > 0

    def _start_convert(self):
        try:
            self.ds.convert_temp()
            self._converting = True
            self._convert_at = time.ticks_ms()
        except Exception:
            self._converting = False

    def poll(self):
        """주기적으로 호출. 변환이 끝났으면 온도를 읽고 다음 변환을 건다."""
        if not self.roms:
            return
        if self._converting and time.ticks_diff(time.ticks_ms(), self._convert_at) >= self.CONVERT_MS:
            try:
                self.last_temp = self.ds.read_temp(self.roms[0])
            except Exception:
                pass
            self._start_convert()


# ---------- WiFi 접속 ----------
def connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    # 보드 이름 설정 → http://<HOSTNAME>.local 로 접속 가능(mDNS 지원 기기)
    try:
        network.hostname(config.HOSTNAME)
    except Exception:
        try:
            wlan.config(hostname=config.HOSTNAME)
        except Exception:
            pass
    wlan.active(True)
    if not wlan.isconnected():
        print("WiFi 접속 중:", config.WIFI_SSID)
        wlan.connect(config.WIFI_SSID, config.WIFI_PASSWORD)
        for _ in range(40):  # 최대 20초 대기
            if wlan.isconnected():
                break
            time.sleep(0.5)
    if wlan.isconnected():
        ip = wlan.ifconfig()[0]
        print("WiFi 연결 완료! 브라우저에서 접속:")
        print("   http://%s" % ip)
        print("   http://%s.local  (mDNS 지원 기기)" % config.HOSTNAME)
        return ip
    print("WiFi 연결 실패. config.py의 SSID/비밀번호를 확인하세요.")
    return None


# ---------- HTTP 응답 ----------
def load_page():
    try:
        with open("web.html", "r") as f:
            return f.read()
    except OSError:
        return "<h1>web.html 파일을 Pico에 함께 올려 주세요.</h1>"


PAGE_HTML = load_page()


def send_response(conn, body, content_type="text/html; charset=utf-8", status="200 OK"):
    header = "HTTP/1.1 %s\r\nContent-Type: %s\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n" % (status, content_type)
    conn.send(header)
    if isinstance(body, str):
        body = body.encode("utf-8")
    conn.sendall(body)


def handle_request(conn, sensor):
    try:
        req = conn.recv(1024)
        if not req:
            return
        line = req.split(b"\r\n", 1)[0].decode("utf-8", "ignore")
        # 예: "GET /temp HTTP/1.1"
        parts = line.split(" ")
        path = parts[1] if len(parts) > 1 else "/"

        if path.startswith("/temp"):
            t = sensor.last_temp
            now = time.ticks_ms()
            if t is None:
                # 아직 온도를 못 읽음(센서 준비 중이거나 미연결)
                body = '{"ok":false,"temp":null,"t":%d,"sensor":%s}' % (
                    now, "true" if sensor.found else "false")
            else:
                body = '{"ok":true,"temp":%.4f,"t":%d,"sensor":true}' % (t, now)
            send_response(conn, body, "application/json")
        elif path == "/" or path.startswith("/index") or path.startswith("/web"):
            send_response(conn, PAGE_HTML)
        else:
            send_response(conn, '{"error":"not found"}', "application/json", "404 Not Found")
    except Exception as e:
        print("요청 처리 오류:", e)
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ---------- 메인 ----------
def main():
    led = machine.Pin("LED", machine.Pin.OUT)
    sensor = TempSensor(config.SENSOR_PIN)
    if not sensor.found:
        print("⚠ DS18B20 센서를 찾지 못했습니다. 배선(데이터선/4.7kΩ 풀업)을 확인하세요.")
    else:
        print("DS18B20 센서 %d개 감지됨." % len(sensor.roms))

    ip = connect_wifi()
    if ip is None:
        # WiFi 실패 시 LED 빠르게 깜빡여 알림
        while True:
            led.toggle()
            time.sleep(0.2)

    addr = socket.getaddrinfo("0.0.0.0", config.HTTP_PORT)[0][-1]
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(addr)
    s.listen(2)
    s.setblocking(False)

    poller = select.poll()
    poller.register(s, select.POLLIN)
    print("웹서버 시작. http://%s 로 접속하세요." % ip)

    last_sample = time.ticks_ms()
    while True:
        # 들어온 접속이 있으면 처리 (100ms 타임아웃으로 센서 폴링도 병행)
        events = poller.poll(100)
        for sock, _ in events:
            if sock is s:
                try:
                    conn, _ = s.accept()
                    conn.settimeout(2.0)
                    handle_request(conn, sensor)
                except Exception as e:
                    print("accept 오류:", e)

        # 주기적으로 센서 변환/읽기
        sensor.poll()
        if time.ticks_diff(time.ticks_ms(), last_sample) >= config.SAMPLE_INTERVAL_MS:
            last_sample = time.ticks_ms()
            led.toggle()  # 살아 있음 표시


main()
