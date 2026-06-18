#!/usr/bin/env bash
# ============================================================
#  Pico 2 W 코드 업로드 스크립트 (macOS / Linux)
#  ⚠ 이 스크립트는 Pico가 USB로 연결된 '사용자 본인 컴퓨터'에서 실행하세요.
#  사용법:  bash upload.sh
# ============================================================
set -e
cd "$(dirname "$0")"

echo "[1/3] 업로드 도구(mpremote) 준비..."
python3 -m pip install --quiet --upgrade mpremote

echo "[2/3] config.py / main.py / web.html 업로드..."
python3 -m mpremote connect auto fs cp config.py :config.py
python3 -m mpremote connect auto fs cp web.html  :web.html
python3 -m mpremote connect auto fs cp main.py   :main.py

echo "[3/3] 보드 재부팅..."
python3 -m mpremote connect auto reset

echo ""
echo "✅ 업로드 완료!  Thonny 등으로 보드의 출력을 보면 접속 주소가 표시됩니다."
echo "   같은 WiFi의 브라우저에서  http://temp-01.local  또는  http://<표시된 IP>  로 접속하세요."
