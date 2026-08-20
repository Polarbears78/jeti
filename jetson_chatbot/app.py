# -*- coding: utf-8 -*-
"""
수업용 LLM 챗봇 서버 (Jetson Orin Nano + Ollama)

- 학생: http://<젯슨IP>:8000        → 접속 암호 입력 후 챗봇 질문
- 교사: http://<젯슨IP>:8000/teacher → 질문 열람 / CSV / LLM 요약 (교사 비밀키)

외부(인터넷) 공개 시에도 안전하도록 접속 암호와 사용량 제한이 걸려 있습니다.

실행 전 준비:
  1) Ollama 실행 중이어야 함 (ollama serve, 기본 포트 11434)
  2) 모델 다운로드: ollama pull exaone3.5:7.8b
  3) pip install flask requests
실행:
  python3 app.py
"""

import csv
import io
import json
import os
import secrets
import sqlite3
import datetime
import threading
import time

import requests
from flask import (
    Flask,
    Response,
    redirect,
    request,
    render_template_string,
    session,
    url_for,
)

# ===== 설정 =====
# 암호는 config.json 에 넣습니다. 이 파일은 git에 올라가지 않습니다(.gitignore).
# config.json 예시:
#   {"student_code": "학생암호", "teacher_key": "교사비밀키"}
# 파일이 없으면 아래 기본값이 쓰이는데, 기본값 그대로 운영하면 안 됩니다.
CONFIG_PATH = "config.json"
_cfg = {}
if os.path.exists(CONFIG_PATH):
    with open(CONFIG_PATH, encoding="utf-8") as f:
        _cfg = json.load(f)

OLLAMA_URL = _cfg.get("ollama_url", "http://127.0.0.1:11434")
# 모델 비교 실측(2026-08-05, 젯슨 오린 나노):
#   exaone3.5:7.8b   11.0초 · 한국어 자연스러움 최상 · 사실오류 없음  ← 채택
#   gemma3:4b         8.8초 · 빠르지만 없는 사실을 지어내는 경우 있음
#   gemma4:e2b-it-qat 20.0초 · 내부 추론에 토큰을 많이 써서 가장 느림
#   qwen2.5:7b        답변 중간에 중국어가 섞여 부적합
MODEL = _cfg.get("model", "exaone3.5:7.8b")
STUDENT_CODE = _cfg.get("student_code", "CHANGE-ME-학생암호")
TEACHER_KEY = _cfg.get("teacher_key", "CHANGE-ME-교사비밀키")
PORT = int(_cfg.get("port", 8000))
DB_PATH = _cfg.get("db_path", "chatlog.db")

# 사용량 제한 (외부 공개 시 남용 방지)
RATE_LIMIT_COUNT = int(_cfg.get("rate_limit_count", 20))   # 한 사람이
RATE_LIMIT_WINDOW = int(_cfg.get("rate_limit_window", 600))  # 이 초 동안 보낼 수 있는 질문 수

# 수업 자료(PDF) — 교사만 올릴 수 있고, 학생 질문에 근거 자료로 쓰인다
MATERIAL_DIR = "materials"
MATERIAL_MAX_MB = 20
# 모델 컨텍스트가 32k라, 자료는 넉넉히 잡아 이 글자 수까지만 쓴다
MATERIAL_MAX_CHARS = int(_cfg.get("material_max_chars", 12000))

SYSTEM_PROMPT = (
    "당신은 육민관고등학교 수업용 학습 도우미입니다.\n"
    "규칙:\n"
    "1. 반드시 한국어로만 답하세요. 중국어, 일본어 문장을 섞지 마세요.\n"
    "2. LaTeX 수식 기호($, \\text, \\frac 등)를 쓰지 마세요. "
    "화학식은 H2O, CO2 처럼 일반 문자로 쓰세요.\n"
    "3. 고등학생 눈높이로 5문장 이내로 간결하게 답하세요.\n"
    "4. 개념 질문에는 실생활 예시를 하나만 들어주세요.\n"
    "5. 숙제나 시험 문제의 정답만 알려달라는 요청에는 "
    "정답 대신 풀이 방향을 안내하세요."
)

app = Flask(__name__)
db_lock = threading.Lock()

# 세션 서명키: 파일에 보관해 서버를 재시작해도 로그인이 유지되도록 함
_SECRET_PATH = "secret.key"
if os.path.exists(_SECRET_PATH):
    with open(_SECRET_PATH, "rb") as f:
        app.secret_key = f.read()
else:
    app.secret_key = secrets.token_bytes(32)
    with open(_SECRET_PATH, "wb") as f:
        f.write(app.secret_key)
    os.chmod(_SECRET_PATH, 0o600)

app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=datetime.timedelta(days=7),
)

# ===== 접속 제한 =====
_rate = {}
_rate_lock = threading.Lock()


def client_ip():
    """Cloudflare 터널을 거치면 실제 접속자 IP는 헤더에 들어온다."""
    for h in ("CF-Connecting-IP", "X-Forwarded-For"):
        v = request.headers.get(h)
        if v:
            return v.split(",")[0].strip()
    return request.remote_addr or "?"


def rate_ok(key):
    now = time.time()
    with _rate_lock:
        hits = [t for t in _rate.get(key, []) if now - t < RATE_LIMIT_WINDOW]
        if len(hits) >= RATE_LIMIT_COUNT:
            _rate[key] = hits
            return False
        hits.append(now)
        _rate[key] = hits
        return True


def student_ok():
    return session.get("student") is True


def teacher_ok():
    return session.get("teacher") is True


# ===== 수업 자료 =====
def material_path(name=""):
    os.makedirs(MATERIAL_DIR, exist_ok=True)
    return os.path.join(MATERIAL_DIR, name) if name else MATERIAL_DIR


def safe_name(name):
    """경로 조작을 막고 파일명만 남긴다."""
    name = os.path.basename(name or "").replace("\\", "")
    return "".join(c for c in name if c not in '/:*?"<>|').strip()[:100]


def list_materials():
    d = material_path()
    if not os.path.isdir(d):
        return []
    out = []
    for f in sorted(os.listdir(d)):
        if f.endswith(".txt"):
            continue
        p = os.path.join(d, f)
        txt = p + ".txt"
        chars = 0
        if os.path.exists(txt):
            chars = os.path.getsize(txt)
        out.append(
            {
                "name": f,
                "size_kb": round(os.path.getsize(p) / 1024),
                "chars": chars,
                "active": session.get("teacher") is not None
                and f == _active_material(),
            }
        )
    return out


def _active_material():
    p = os.path.join(material_path(), ".active")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            name = f.read().strip()
        if name and os.path.exists(os.path.join(material_path(), name)):
            return name
    return ""


def set_active_material(name):
    with open(os.path.join(material_path(), ".active"), "w", encoding="utf-8") as f:
        f.write(name or "")


def extract_pdf_text(path):
    """PDF에서 글자를 뽑아 .txt 로 저장하고, 뽑은 글자 수를 돌려준다."""
    from pypdf import PdfReader

    reader = PdfReader(path)
    parts = []
    total = 0
    for page in reader.pages:
        t = (page.extract_text() or "").strip()
        if not t:
            continue
        parts.append(t)
        total += len(t)
        if total > MATERIAL_MAX_CHARS * 2:
            break
    text = "\n\n".join(parts)
    with open(path + ".txt", "w", encoding="utf-8") as f:
        f.write(text)
    return len(text), len(reader.pages)


def active_material_text():
    """학생 질문에 붙일 수업 자료 본문. 없으면 빈 문자열."""
    name = _active_material()
    if not name:
        return "", ""
    txt = os.path.join(material_path(), name + ".txt")
    if not os.path.exists(txt):
        return "", ""
    with open(txt, encoding="utf-8") as f:
        return name, f.read()[:MATERIAL_MAX_CHARS]


# ===== DB =====
def init_db():
    with sqlite3.connect(DB_PATH) as con:
        con.execute(
            """CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                student TEXT,
                question TEXT NOT NULL,
                answer TEXT
            )"""
        )


def save_log(student, question, answer):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with db_lock, sqlite3.connect(DB_PATH) as con:
        con.execute(
            "INSERT INTO logs (ts, student, question, answer) VALUES (?, ?, ?, ?)",
            (ts, student, question, answer),
        )


def fetch_logs(date=None):
    with sqlite3.connect(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        if date:
            rows = con.execute(
                "SELECT * FROM logs WHERE ts LIKE ? ORDER BY id DESC", (date + "%",)
            ).fetchall()
        else:
            rows = con.execute("SELECT * FROM logs ORDER BY id DESC").fetchall()
    return rows


def fetch_dates():
    with sqlite3.connect(DB_PATH) as con:
        rows = con.execute(
            "SELECT DISTINCT substr(ts, 1, 10) AS d FROM logs ORDER BY d DESC"
        ).fetchall()
    return [r[0] for r in rows]


# ===== 학생 페이지 =====
STUDENT_HTML = """
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>수업 챗봇</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Malgun Gothic', sans-serif; background: #f2f4f8;
         display: flex; flex-direction: column; height: 100dvh; }
  header { background: #2d5be3; color: #fff; padding: 10px 14px; font-weight: bold; }
  header small { font-weight: normal; opacity: .85; margin-left: 8px; }
  #chat { flex: 1; overflow-y: auto; padding: 12px; }
  .msg { max-width: 85%; margin: 6px 0; padding: 9px 12px; border-radius: 12px;
         white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
  .me { background: #2d5be3; color: #fff; margin-left: auto; border-bottom-right-radius: 3px; }
  .bot { background: #fff; border: 1px solid #dde2ec; border-bottom-left-radius: 3px; }
  form { display: flex; gap: 6px; padding: 10px; background: #fff; border-top: 1px solid #dde2ec; }
  #q { flex: 1; padding: 10px; border: 1px solid #c6cede; border-radius: 8px; font-size: 16px; }
  button { padding: 10px 16px; border: 0; border-radius: 8px; background: #2d5be3;
           color: #fff; font-size: 15px; }
  button:disabled { background: #9db1e8; }
  #namebar { padding: 8px 12px; background: #e8edf8; font-size: 14px; }
  #name { border: 1px solid #c6cede; border-radius: 6px; padding: 4px 8px; width: 130px; }
</style>
</head>
<body>
<header>수업 챗봇 <small>{% if material %}자료: {{ material }}{% else %}궁금한 것을 질문하세요{% endif %}</small></header>
<div id="namebar">이름(또는 조): <input id="name" placeholder="예: 2조 김철수"></div>
<div id="chat"></div>
<form id="f">
  <input id="q" autocomplete="off" placeholder="질문을 입력하세요">
  <button id="send">전송</button>
</form>
<script>
const chat = document.getElementById('chat');
const nameEl = document.getElementById('name');
nameEl.value = localStorage.getItem('student_name') || '';
nameEl.addEventListener('change', () => localStorage.setItem('student_name', nameEl.value));

let history = [];  // [{role, content}, ...] 최근 대화 문맥

function addMsg(cls, text) {
  const d = document.createElement('div');
  d.className = 'msg ' + cls;
  d.textContent = text;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
  return d;
}

document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  if (!q) return;
  document.getElementById('q').value = '';
  document.getElementById('send').disabled = true;
  addMsg('me', q);
  const botEl = addMsg('bot', '...');
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameEl.value, question: q, history: history.slice(-6) })
    });
    if (!res.ok) throw new Error('서버 오류 (' + res.status + ')');
    botEl.textContent = '';
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let answer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      answer += dec.decode(value, { stream: true });
      botEl.textContent = answer;
      chat.scrollTop = chat.scrollHeight;
    }
    history.push({ role: 'user', content: q }, { role: 'assistant', content: answer });
  } catch (err) {
    botEl.textContent = '오류가 발생했어요. 잠시 후 다시 시도해 주세요. (' + err.message + ')';
  } finally {
    document.getElementById('send').disabled = false;
  }
});
</script>
</body>
</html>
"""


LOGIN_HTML = """
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{ title }}</title>
<style>
  body { margin: 0; font-family: 'Malgun Gothic', sans-serif; background: #f2f4f8;
         display: flex; align-items: center; justify-content: center; height: 100dvh; }
  form { background: #fff; padding: 26px 22px; border-radius: 12px; width: 300px;
         box-shadow: 0 2px 14px rgba(0,0,0,.08); }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { color: #667; font-size: 13px; margin: 0 0 16px; }
  input { width: 100%; padding: 11px; border: 1px solid #c6cede; border-radius: 8px;
          font-size: 16px; margin-bottom: 10px; box-sizing: border-box; }
  button { width: 100%; padding: 11px; border: 0; border-radius: 8px; background: #2d5be3;
           color: #fff; font-size: 15px; }
  .err { color: #c0392b; font-size: 13px; margin-bottom: 10px; }
</style>
</head>
<body>
<form method="post">
  <h1>{{ title }}</h1>
  <p>{{ hint }}</p>
  {% if error %}<div class="err">{{ error }}</div>{% endif %}
  <input type="password" name="code" placeholder="암호" autofocus>
  <button>입장</button>
</form>
</body>
</html>
"""


@app.route("/", methods=["GET", "POST"])
def student_page():
    if student_ok():
        return render_template_string(STUDENT_HTML, material=_active_material())
    error = None
    if request.method == "POST":
        if not rate_ok("login:" + client_ip()):
            error = "시도가 너무 많습니다. 잠시 후 다시 해주세요."
        elif secrets.compare_digest(
            (request.form.get("code") or ""), STUDENT_CODE
        ):
            session.permanent = True
            session["student"] = True
            return redirect(url_for("student_page"))
        else:
            error = "암호가 올바르지 않습니다."
    return (
        render_template_string(
            LOGIN_HTML,
            title="수업 챗봇",
            hint="선생님께 받은 접속 암호를 입력하세요.",
            error=error,
        ),
        200 if request.method == "GET" else 401,
    )


@app.route("/api/chat", methods=["POST"])
def api_chat():
    if not student_ok():
        return "로그인이 필요합니다.", 401
    if not rate_ok("chat:" + client_ip()):
        return (
            "질문이 너무 많습니다. 10분 후에 다시 시도해 주세요.",
            429,
        )
    data = request.get_json(force=True)
    student = (data.get("name") or "").strip()[:50]
    question = (data.get("question") or "").strip()[:2000]
    history = data.get("history") or []
    if not question:
        return "질문이 비어 있습니다.", 400

    system = SYSTEM_PROMPT
    mat_name, mat_text = active_material_text()
    if mat_text:
        # 수업 자료가 지정돼 있으면 그 내용을 근거로 답하게 한다.
        system += (
            f"\n\n=== 수업 자료: {mat_name} ===\n{mat_text}\n=== 자료 끝 ===\n\n"
            "위 수업 자료를 기준으로 답하세요. 답하기 전에 질문 내용이 자료 안에 "
            "있는지 먼저 확인하십시오.\n"
            "- 자료에 있으면: 자료 내용을 근거로 답합니다.\n"
            "- 자료에 없으면: 반드시 첫 문장을 "
            "'수업 자료에는 없는 내용이지만,' 으로 시작한 뒤 일반 지식으로 답합니다.\n"
            "이 규칙은 예외 없이 지켜야 합니다."
        )

    messages = [{"role": "system", "content": system}]
    for m in history[-6:]:
        if m.get("role") in ("user", "assistant") and m.get("content"):
            messages.append({"role": m["role"], "content": str(m["content"])[:2000]})
    messages.append({"role": "user", "content": question})

    def generate():
        answer_parts = []
        try:
            with requests.post(
                f"{OLLAMA_URL}/api/chat",
                json={"model": MODEL, "messages": messages, "stream": True},
                stream=True,
                timeout=300,
            ) as r:
                r.raise_for_status()
                for line in r.iter_lines():
                    if not line:
                        continue
                    chunk = json.loads(line)
                    piece = chunk.get("message", {}).get("content", "")
                    if piece:
                        answer_parts.append(piece)
                        yield piece
                    if chunk.get("done"):
                        break
        except Exception as e:
            yield f"\n[오류: 모델 응답 실패 — {e}]"
        finally:
            save_log(student, question, "".join(answer_parts))

    return Response(generate(), mimetype="text/plain; charset=utf-8")


# ===== 교사 페이지 =====
TEACHER_HTML = """
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>교사용 - 질문 기록</title>
<style>
  body { font-family: 'Malgun Gothic', sans-serif; background: #f2f4f8; margin: 0; padding: 16px; }
  h2 { margin-top: 0; }
  .bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
  select, button, a.btn { padding: 8px 12px; border-radius: 8px; border: 1px solid #c6cede;
    background: #fff; font-size: 14px; text-decoration: none; color: #222; cursor: pointer; }
  button.primary { background: #2d5be3; color: #fff; border: 0; }
  table { width: 100%; border-collapse: collapse; background: #fff; }
  th, td { border: 1px solid #dde2ec; padding: 8px; font-size: 14px; vertical-align: top;
           text-align: left; }
  th { background: #e8edf8; }
  td.ans { color: #555; }
  #summary { background: #fff; border: 1px solid #dde2ec; border-radius: 8px;
             padding: 14px; margin: 12px 0; white-space: pre-wrap; line-height: 1.6; display: none; }
  .count { color: #666; font-size: 14px; }
  .panel { background: #fff; border: 1px solid #dde2ec; border-radius: 8px;
           padding: 14px; margin: 16px 0; }
  .panel h3 { margin: 0 0 6px; font-size: 16px; }
  .hint { color: #667; font-size: 13px; margin: 0 0 12px; }
</style>
</head>
<body>
<h2>학생 질문 기록</h2>
<div class="bar">
  <form method="get" style="display:flex; gap:8px; align-items:center;">
    <select name="date" onchange="this.form.submit()">
      <option value="">전체 날짜</option>
      {% for d in dates %}
      <option value="{{ d }}" {% if d == date %}selected{% endif %}>{{ d }}</option>
      {% endfor %}
    </select>
  </form>
  <a class="btn" href="/teacher/csv?date={{ date }}">CSV 다운로드</a>
  <button class="primary" id="sumbtn" onclick="makeSummary()">질문 요약 (AI)</button>
  <span class="count">총 {{ rows|length }}건</span>
  <a class="btn" href="/logout">로그아웃</a>
</div>
<div id="summary"></div>

<div class="panel">
  <h3>수업 자료 (PDF)</h3>
  <p class="hint">자료를 올리고 <b>사용</b>을 누르면, 학생 질문에 이 자료를 근거로 답합니다.
     자료 없이 쓰려면 <b>사용 안 함</b>을 누르세요.</p>
  <form method="post" action="/teacher/material/upload" enctype="multipart/form-data"
        style="margin-bottom:10px">
    <input type="file" name="pdf" accept="application/pdf" required>
    <button class="primary">올리기</button>
  </form>
  <table>
    <tr><th>파일</th><th style="width:90px">크기</th><th style="width:110px">읽은 글자</th>
        <th style="width:170px">상태</th></tr>
    <tr>
      <td colspan="3" style="color:#667">(자료 사용 안 함 — 일반 질문만)</td>
      <td>{% if not active %}<b>● 사용 중</b>{% else %}
        <form method="post" action="/teacher/material/select" style="display:inline">
          <input type="hidden" name="name" value="">
          <button>사용 안 함</button></form>{% endif %}</td>
    </tr>
    {% for m in materials %}
    <tr>
      <td>{{ m.name }}</td>
      <td>{{ m.size_kb }} KB</td>
      <td>{% if m.chars %}{{ m.chars }}자{% else %}<span style="color:#c0392b">추출 실패</span>{% endif %}</td>
      <td>
        {% if m.name == active %}<b>● 사용 중</b>{% else %}
        <form method="post" action="/teacher/material/select" style="display:inline">
          <input type="hidden" name="name" value="{{ m.name }}">
          <button class="primary">사용</button></form>
        {% endif %}
        <form method="post" action="/teacher/material/delete" style="display:inline"
              onsubmit="return confirm('{{ m.name }} 을(를) 삭제할까요?')">
          <input type="hidden" name="name" value="{{ m.name }}">
          <button>삭제</button></form>
      </td>
    </tr>
    {% endfor %}
  </table>
  {% if msg %}<p class="hint" style="color:#2d5be3">{{ msg }}</p>{% endif %}
</div>
<table>
  <tr><th style="width:130px">시각</th><th style="width:110px">학생</th><th>질문</th><th>답변(요약)</th></tr>
  {% for r in rows %}
  <tr>
    <td>{{ r['ts'] }}</td>
    <td>{{ r['student'] }}</td>
    <td>{{ r['question'] }}</td>
    <td class="ans">{{ (r['answer'] or '')[:120] }}{% if r['answer'] and r['answer']|length > 120 %}…{% endif %}</td>
  </tr>
  {% endfor %}
</table>
<script>
async function makeSummary() {
  const btn = document.getElementById('sumbtn');
  const box = document.getElementById('summary');
  btn.disabled = true; btn.textContent = '요약 생성 중... (1~2분)';
  box.style.display = 'block'; box.textContent = '요약을 만드는 중입니다...';
  try {
    const res = await fetch('/teacher/summary?date={{ date }}', { method: 'POST' });
    box.textContent = await res.text();
  } catch (e) {
    box.textContent = '요약 생성 실패: ' + e.message;
  } finally {
    btn.disabled = false; btn.textContent = '질문 요약 (AI)';
  }
}
</script>
</body>
</html>
"""


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("student_page"))


@app.route("/teacher", methods=["GET", "POST"])
def teacher_page():
    if not teacher_ok():
        error = None
        if request.method == "POST":
            if not rate_ok("login:" + client_ip()):
                error = "시도가 너무 많습니다. 잠시 후 다시 해주세요."
            elif secrets.compare_digest(
                (request.form.get("code") or ""), TEACHER_KEY
            ):
                session.permanent = True
                session["teacher"] = True
                return redirect(url_for("teacher_page"))
            else:
                error = "비밀키가 올바르지 않습니다."
        return (
            render_template_string(
                LOGIN_HTML,
                title="교사용 질문 기록",
                hint="교사 비밀키를 입력하세요.",
                error=error,
            ),
            200 if request.method == "GET" else 401,
        )
    date = request.args.get("date", "")
    rows = fetch_logs(date or None)
    return render_template_string(
        TEACHER_HTML,
        rows=rows,
        dates=fetch_dates(),
        date=date,
        materials=list_materials(),
        active=_active_material(),
        msg=request.args.get("msg", ""),
    )


@app.route("/teacher/material/upload", methods=["POST"])
def material_upload():
    if not teacher_ok():
        return "권한 없음", 401
    f = request.files.get("pdf")
    if not f or not f.filename:
        return redirect(url_for("teacher_page", msg="파일이 없습니다."))
    name = safe_name(f.filename)
    if not name.lower().endswith(".pdf"):
        return redirect(url_for("teacher_page", msg="PDF 파일만 올릴 수 있습니다."))

    path = material_path(name)
    f.save(path)
    size_mb = os.path.getsize(path) / 1024 / 1024
    if size_mb > MATERIAL_MAX_MB:
        os.remove(path)
        return redirect(
            url_for("teacher_page", msg=f"파일이 너무 큽니다({size_mb:.1f}MB). "
                                        f"{MATERIAL_MAX_MB}MB 이하만 됩니다.")
        )
    try:
        chars, pages = extract_pdf_text(path)
    except Exception as e:
        os.remove(path)
        return redirect(url_for("teacher_page", msg=f"PDF를 읽지 못했습니다: {e}"))

    if chars == 0:
        return redirect(
            url_for(
                "teacher_page",
                msg=f"{name}: 글자를 찾지 못했습니다. 스캔 이미지 PDF는 "
                    "글자 인식이 안 되어 사용할 수 없습니다.",
            )
        )
    set_active_material(name)
    over = ""
    if chars > MATERIAL_MAX_CHARS:
        over = (f" 다만 분량이 많아 앞부분 {MATERIAL_MAX_CHARS}자만 사용합니다"
                f"(전체 {chars}자).")
    return redirect(
        url_for(
            "teacher_page",
            msg=f"{name} 올리기 완료 ({pages}쪽, {chars}자). 지금부터 이 자료를 사용합니다.{over}",
        )
    )


@app.route("/teacher/material/select", methods=["POST"])
def material_select():
    if not teacher_ok():
        return "권한 없음", 401
    name = safe_name(request.form.get("name", ""))
    if name and not os.path.exists(material_path(name)):
        return redirect(url_for("teacher_page", msg="없는 파일입니다."))
    set_active_material(name)
    return redirect(
        url_for(
            "teacher_page",
            msg=f"'{name}' 자료를 사용합니다." if name else "자료를 쓰지 않습니다.",
        )
    )


@app.route("/teacher/material/delete", methods=["POST"])
def material_delete():
    if not teacher_ok():
        return "권한 없음", 401
    name = safe_name(request.form.get("name", ""))
    p = material_path(name)
    if not name or not os.path.exists(p):
        return redirect(url_for("teacher_page", msg="없는 파일입니다."))
    os.remove(p)
    if os.path.exists(p + ".txt"):
        os.remove(p + ".txt")
    if _active_material() == name:
        set_active_material("")
    return redirect(url_for("teacher_page", msg=f"{name} 삭제했습니다."))


@app.route("/teacher/csv")
def teacher_csv():
    if not teacher_ok():
        return "권한 없음", 401
    date = request.args.get("date", "")
    rows = fetch_logs(date or None)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["시각", "학생", "질문", "답변"])
    for r in rows:
        w.writerow([r["ts"], r["student"], r["question"], r["answer"]])
    filename = f"questions_{date or 'all'}.csv"
    return Response(
        "﻿" + buf.getvalue(),  # BOM: 엑셀에서 한글 깨짐 방지
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.route("/teacher/summary", methods=["POST"])
def teacher_summary():
    if not teacher_ok():
        return "권한 없음", 401
    date = request.args.get("date", "")
    rows = fetch_logs(date or None)
    if not rows:
        return "기록된 질문이 없습니다."

    q_list = "\n".join(
        f"- ({r['student'] or '무명'}) {r['question']}" for r in reversed(rows[:200])
    )
    prompt = (
        "다음은 수업 시간에 학생들이 챗봇에 한 질문 목록입니다.\n"
        "교사가 한눈에 파악할 수 있도록 아래 형식으로 정리해 주세요.\n"
        "1. 주제별 분류 (주제마다 관련 질문 수와 대표 질문)\n"
        "2. 가장 많이 나온 질문/관심사 TOP 3\n"
        "3. 학생들이 어려워하는 것으로 보이는 개념과 수업에서 보충하면 좋을 내용 제안\n\n"
        f"질문 목록:\n{q_list}"
    )
    try:
        r = requests.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
            },
            timeout=600,
        )
        r.raise_for_status()
        return r.json().get("message", {}).get("content", "(응답 없음)")
    except Exception as e:
        return f"요약 생성 실패: {e}", 500


if __name__ == "__main__":
    init_db()
    print(f" * 학생 페이지: http://<젯슨IP>:{PORT}  (암호: {STUDENT_CODE})")
    print(f" * 교사 페이지: http://<젯슨IP>:{PORT}/teacher  (비밀키: {TEACHER_KEY})")
    app.run(host="0.0.0.0", port=PORT, threaded=True)
