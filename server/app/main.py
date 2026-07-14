from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

DB_PATH = os.getenv("WORDHINT_DATABASE", str(Path(__file__).parent.parent / "wordhint.db"))
SECRET = os.getenv("WORDHINT_SECRET", "change-me-in-production").encode()
TOKEN_TTL = 60 * 60 * 24 * 30

app = FastAPI(title="WordHint Cloud", version="1.0.0")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_time(value: str | None, fallback: str) -> str:
    if not value:
        return fallback
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except ValueError:
        return fallback


@contextmanager
def db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def init_db() -> None:
    with db() as conn:
        conn.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
          password_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
          role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL, last_login_at TEXT
        );
        CREATE TABLE IF NOT EXISTS words (
          user_id INTEGER NOT NULL, normalized_word TEXT NOT NULL, payload TEXT NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, normalized_word), FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY, user_id INTEGER, kind TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
        """)
    bootstrap_admin()


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"{base64.urlsafe_b64encode(salt).decode()}${base64.urlsafe_b64encode(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_text, _ = stored.split("$", 1)
        return hmac.compare_digest(hash_password(password, base64.urlsafe_b64decode(salt_text)), stored)
    except (ValueError, TypeError):
        return False


def make_token(user_id: int) -> str:
    payload = f"{user_id}:{int(time.time()) + TOKEN_TTL}"
    signature = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}:{signature}".encode()).decode()


def parse_token(token: str) -> int:
    try:
        user, expiry, signature = base64.urlsafe_b64decode(token.encode()).decode().split(":")
        payload = f"{user}:{expiry}"
        expected = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()
        if int(expiry) < time.time() or not hmac.compare_digest(signature, expected):
            raise ValueError
        return int(user)
    except Exception as exc:
        raise HTTPException(401, "登录已失效") from exc


def current_user(authorization: str | None = Header(default=None)) -> sqlite3.Row:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "请先登录")
    user_id = parse_token(authorization[7:])
    with db() as conn:
        user = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not user or user["status"] != "approved":
        raise HTTPException(403, "账号尚未获批或已停用")
    return user


def admin_user(user: sqlite3.Row = Depends(current_user)) -> sqlite3.Row:
    if user["role"] != "admin":
        raise HTTPException(403, "需要管理员权限")
    return user


def bootstrap_admin() -> None:
    email = os.getenv("WORDHINT_ADMIN_EMAIL")
    password = os.getenv("WORDHINT_ADMIN_PASSWORD")
    if not email or not password:
        return
    with db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO users(email,name,password_hash,status,role,created_at) VALUES(?,?,?,?,?,?)",
            (email.lower(), "管理员", hash_password(password), "approved", "admin", now()),
        )


class Credentials(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)


class RegisterRequest(Credentials):
    name: str = Field(min_length=1, max_length=50)


class SyncWord(BaseModel):
    word: str
    meaning: str = ""
    sentence: str = ""
    generatedSentence: str | None = None
    time: str | None = None
    lemma: str | None = None
    partOfSpeech: str | None = None
    phonetic: str | None = None
    englishDefinition: str | None = None
    sourceURL: str | None = None
    note: str | None = None
    statusRaw: str | None = None
    repetitions: int | None = None
    intervalDays: int | None = None
    easeFactor: float | None = None
    lapseCount: int | None = None
    lastReviewedAt: str | None = None
    nextReviewAt: str | None = None
    updatedAt: str | None = None
    deleted: bool = False


class SyncRequest(BaseModel):
    words: list[SyncWord] = []
    whitelist: list[str] = []
    since: str | None = None


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "time": now()}


@app.post("/api/v1/auth/register", status_code=201)
def register(body: RegisterRequest) -> dict[str, str]:
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(422, "邮箱格式不正确")
    try:
        with db() as conn:
            conn.execute(
                "INSERT INTO users(email,name,password_hash,status,role,created_at) VALUES(?,?,?,?,?,?)",
                (email, body.name.strip(), hash_password(body.password), "pending", "user", now()),
            )
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "该邮箱已注册") from exc
    return {"status": "pending", "message": "注册成功，请等待管理员审批"}


@app.post("/api/v1/auth/login")
def login(body: Credentials) -> dict[str, Any]:
    with db() as conn:
        user = conn.execute("SELECT * FROM users WHERE email=?", (body.email.strip().lower(),)).fetchone()
        if not user or not verify_password(body.password, user["password_hash"]):
            raise HTTPException(401, "邮箱或密码错误")
        if user["status"] != "approved":
            raise HTTPException(403, "账号正在等待审批" if user["status"] == "pending" else "账号已停用")
        conn.execute("UPDATE users SET last_login_at=? WHERE id=?", (now(), user["id"]))
        conn.execute("INSERT INTO events(user_id,kind,created_at) VALUES(?,?,?)", (user["id"], "login", now()))
    return {"token": make_token(user["id"]), "user": {"email": user["email"], "name": user["name"], "role": user["role"]}}


@app.get("/api/v1/me")
def me(user: sqlite3.Row = Depends(current_user)) -> dict[str, str]:
    return {"email": user["email"], "name": user["name"], "role": user["role"]}


@app.post("/api/v1/sync")
def sync(body: SyncRequest, user: sqlite3.Row = Depends(current_user)) -> dict[str, Any]:
    timestamp = now()
    incoming = list(body.words)
    incoming.extend(SyncWord(word=w, statusRaw="ignored", updatedAt=timestamp) for w in body.whitelist)
    with db() as conn:
        for item in incoming:
            key = item.word.strip().lower()
            if not key:
                continue
            existing = conn.execute("SELECT payload,updated_at FROM words WHERE user_id=? AND normalized_word=?", (user["id"], key)).fetchone()
            client_time = canonical_time(item.updatedAt or item.time, timestamp)
            if existing and datetime.fromisoformat(existing["updated_at"]) > datetime.fromisoformat(client_time):
                continue
            payload = item.model_dump(exclude={"updatedAt", "deleted"})
            conn.execute(
                "INSERT INTO words(user_id,normalized_word,payload,deleted,updated_at) VALUES(?,?,?,?,?) "
                "ON CONFLICT(user_id,normalized_word) DO UPDATE SET payload=excluded.payload,deleted=excluded.deleted,updated_at=excluded.updated_at",
                (user["id"], key, json.dumps(payload, ensure_ascii=False), int(item.deleted), client_time),
            )
        rows = conn.execute(
            "SELECT payload,deleted,updated_at FROM words WHERE user_id=? AND (? IS NULL OR updated_at>?) ORDER BY updated_at",
            (user["id"], body.since, body.since),
        ).fetchall()
        conn.execute("INSERT INTO events(user_id,kind,amount,created_at) VALUES(?,?,?,?)", (user["id"], "sync", len(incoming), timestamp))
    words = []
    for row in rows:
        item = json.loads(row["payload"])
        item.update({"deleted": bool(row["deleted"]), "updatedAt": row["updated_at"]})
        words.append(item)
    return {"words": words, "serverTime": timestamp}


def get_llm_settings() -> dict[str, Any]:
    defaults = {
        "base_url": os.getenv("WORDHINT_LLM_BASE_URL", "http://127.0.0.1:6018"),
        "model": os.getenv("WORDHINT_LLM_MODEL", "qwen3.5-397b-a17b"),
        "api_key": os.getenv("WORDHINT_LLM_API_KEY", ""), "temperature": 0, "max_tokens": 5000,
    }
    with db() as conn:
        rows = conn.execute("SELECT key,value FROM settings WHERE key LIKE 'llm.%'").fetchall()
    for row in rows:
        defaults[row["key"][4:]] = json.loads(row["value"])
    return defaults


@app.post("/api/v1/llm/chat")
async def llm_proxy(request: Request, user: sqlite3.Row = Depends(current_user)):
    body = await request.json()
    settings = get_llm_settings()
    body["model"] = settings["model"]
    body["temperature"] = settings["temperature"]
    body["max_tokens"] = min(int(body.get("max_tokens", 5000)), int(settings["max_tokens"]))
    body["chat_template_kwargs"] = {"enable_thinking": False}
    url = f"{settings['base_url'].rstrip('/')}/{settings['model']}/v1/chat/completions"
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "Authorization": f"Bearer {settings['api_key']}"})
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            data = json.loads(response.read())
    except Exception as exc:
        raise HTTPException(502, f"模型服务不可用: {exc}") from exc
    with db() as conn:
        conn.execute("INSERT INTO events(user_id,kind,created_at) VALUES(?,?,?)", (user["id"], "llm", now()))
    return data


@app.get("/api/v1/admin/users")
def list_users(_: sqlite3.Row = Depends(admin_user)):
    with db() as conn:
        rows = conn.execute("SELECT id,email,name,status,role,created_at,last_login_at FROM users ORDER BY created_at DESC").fetchall()
    return [dict(row) for row in rows]


@app.patch("/api/v1/admin/users/{user_id}")
async def update_user(user_id: int, request: Request, _: sqlite3.Row = Depends(admin_user)):
    body = await request.json()
    status = body.get("status")
    if status not in {"pending", "approved", "disabled"}:
        raise HTTPException(422, "无效状态")
    with db() as conn:
        conn.execute("UPDATE users SET status=? WHERE id=? AND role!='admin'", (status, user_id))
    return {"ok": True}


@app.get("/api/v1/admin/stats")
def stats(_: sqlite3.Row = Depends(admin_user)):
    with db() as conn:
        users = conn.execute("SELECT status,COUNT(*) count FROM users GROUP BY status").fetchall()
        words = conn.execute("SELECT COUNT(*) count FROM words WHERE deleted=0").fetchone()["count"]
        events = conn.execute("SELECT kind,COUNT(*) count FROM events GROUP BY kind").fetchall()
    return {"users": {r["status"]: r["count"] for r in users}, "words": words, "events": {r["kind"]: r["count"] for r in events}}


@app.get("/api/v1/admin/llm")
def read_llm(_: sqlite3.Row = Depends(admin_user)):
    value = get_llm_settings()
    value["api_key"] = "********" if value["api_key"] else ""
    return value


@app.put("/api/v1/admin/llm")
async def write_llm(request: Request, _: sqlite3.Row = Depends(admin_user)):
    body = await request.json()
    allowed = {"base_url", "model", "api_key", "temperature", "max_tokens"}
    with db() as conn:
        for key, value in body.items():
            if key in allowed and not (key == "api_key" and value == "********"):
                conn.execute("INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", (f"llm.{key}", json.dumps(value), now()))
    return {"ok": True}


@app.get("/admin", response_class=HTMLResponse)
def admin_page():
    return ADMIN_HTML


ADMIN_HTML = r'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>WordHint 管理台</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f1ed;color:#25211f;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{background:#b95737;color:white;padding:20px 5vw;font-size:21px;font-weight:700}main{max-width:1080px;margin:28px auto;padding:0 20px}.card{background:#fffdfb;border:1px solid #e4d9d2;border-radius:8px;padding:20px;margin-bottom:18px}input,button{font:inherit;padding:10px 12px;border-radius:6px;border:1px solid #d8ccc5}button{background:#b95737;color:white;border:0;cursor:pointer}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:11px 8px;border-bottom:1px solid #eee4de}.row{display:flex;gap:10px;flex-wrap:wrap}.row input{flex:1;min-width:180px}.muted{color:#776d68}.stats{display:flex;gap:24px;font-size:18px}.hidden{display:none}</style></head><body><header>WordHint 管理台</header><main>
<section id="loginCard" class="card"><h2>管理员登录</h2><div class="row"><input id="email" placeholder="邮箱"><input id="password" type="password" placeholder="密码"><button onclick="adminLogin()">登录</button></div><p id="message" class="muted"></p></section>
<div id="panel" class="hidden"><section class="card"><h2>使用概况</h2><div id="stats" class="stats"></div></section><section class="card"><h2>注册审批</h2><table><thead><tr><th>用户</th><th>状态</th><th>注册时间</th><th>操作</th></tr></thead><tbody id="users"></tbody></table></section><section class="card"><h2>大模型配置</h2><div class="row"><input id="base_url" placeholder="Base URL"><input id="model" placeholder="模型"><input id="api_key" placeholder="API Key"><input id="max_tokens" type="number" placeholder="Max tokens"><button onclick="saveLLM()">保存</button></div></section></div></main><script>
let token=localStorage.whToken||'';const api=async(path,opt={})=>{opt.headers={...(opt.headers||{}),Authorization:'Bearer '+token,'Content-Type':'application/json'};const r=await fetch(path,opt);const j=await r.json();if(!r.ok)throw Error(j.detail||'请求失败');return j};
async function adminLogin(){try{const r=await fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.value,password:password.value})});const j=await r.json();if(!r.ok)throw Error(j.detail);token=j.token;localStorage.whToken=token;load()}catch(e){message.textContent=e.message}}
async function load(){try{const [u,s,l]=await Promise.all([api('/api/v1/admin/users'),api('/api/v1/admin/stats'),api('/api/v1/admin/llm')]);loginCard.classList.add('hidden');panel.classList.remove('hidden');stats.textContent=`用户 ${Object.values(s.users).reduce((a,b)=>a+b,0)} · 单词 ${s.words} · 同步 ${s.events.sync||0} · AI ${s.events.llm||0}`;users.innerHTML=u.map(x=>`<tr><td><b>${x.name}</b><br><span class=muted>${x.email}</span></td><td>${x.status}</td><td>${x.created_at.slice(0,10)}</td><td>${x.role==='admin'?'管理员':`<button onclick="approve(${x.id},'approved')">批准</button> <button onclick="approve(${x.id},'disabled')">停用</button>`}</td></tr>`).join('');Object.entries(l).forEach(([k,v])=>{const e=document.getElementById(k);if(e)e.value=v})}catch(e){localStorage.removeItem('whToken')}}
async function approve(id,status){await api('/api/v1/admin/users/'+id,{method:'PATCH',body:JSON.stringify({status})});load()}async function saveLLM(){await api('/api/v1/admin/llm',{method:'PUT',body:JSON.stringify({base_url:base_url.value,model:model.value,api_key:api_key.value,max_tokens:+max_tokens.value,temperature:0})});alert('已保存')}if(token)load();
</script></body></html>'''
