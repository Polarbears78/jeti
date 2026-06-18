@echo off
REM ============================================================
REM  Pico 2 W 코드 업로드 스크립트 (Windows)
REM  [주의] Pico가 USB로 연결된 '사용자 본인 컴퓨터'에서 실행하세요.
REM  사용법: 이 파일(upload.bat)을 더블클릭하거나, 명령창에서 upload.bat 실행
REM ============================================================
cd /d "%~dp0"

echo [1/3] 업로드 도구(mpremote) 준비...
python -m pip install --quiet --upgrade mpremote

echo [2/3] config.py / main.py / web.html 업로드...
python -m mpremote connect auto fs cp config.py :config.py
python -m mpremote connect auto fs cp web.html  :web.html
python -m mpremote connect auto fs cp main.py   :main.py

echo [3/3] 보드 재부팅...
python -m mpremote connect auto reset

echo.
echo [완료] 업로드 끝! 같은 WiFi의 브라우저에서 http://temp-01.local 로 접속하세요.
pause
