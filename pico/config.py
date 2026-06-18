# ===== 사용자 설정 =====
# 1) 집/학교 WiFi 정보를 입력하세요. (Pico 2 W는 2.4GHz WiFi만 지원)
WIFI_SSID = "여기에-WiFi-이름"
WIFI_PASSWORD = "여기에-WiFi-비밀번호"

# 2) DS18B20 방수 온도센서를 연결한 GPIO 번호 (데이터선)
#    아래 README의 배선도를 따르면 GP15 입니다.
SENSOR_PIN = 15

# 3) 온도 수집 간격(밀리초). DS18B20는 변환에 ~0.75초가 걸려
#    1000ms(1초) 이상을 권장합니다.
SAMPLE_INTERVAL_MS = 1000

# 4) 웹서버 포트 (보통 80 그대로 두면 됩니다)
HTTP_PORT = 80
