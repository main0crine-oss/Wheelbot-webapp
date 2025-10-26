
import os
import csv
import hmac
import hashlib
import sqlite3
import urllib.parse
from datetime import datetime
from typing import List, Optional, Dict, Any
import random

from fastapi import FastAPI, HTTPException, Header, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ====== Config ======
DB_PATH = os.getenv("DB_PATH", "wheel.db")
NANO = 1_000_000_000
START_BALANCE_TON = float(os.getenv("START_BALANCE_TON", "0"))
START_BALANCE = int(START_BALANCE_TON * NANO)
MIN_BET = int(float(os.getenv("MIN_BET_TON", "0.1")) * NANO)
MAX_BET = int(float(os.getenv("MAX_BET_TON", "10")) * NANO)
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "8405321344:AAGd8XsGYYJkLRBnuMeS-OCfxakwxwc7NsM")
ADMIN_WHITELIST = [x.strip().lower() for x in os.getenv("ADMIN_WHITELIST", "@Sashadwr").split(",") if x.strip()]
TON_WALLET_ADDRESS = os.getenv("TON_WALLET_ADDRESS", "UQDa3zYDhrj1ymplHYrAfoI6d2dkWc_-ai6bhpkEAFNKOsWf")
# Optional: provider secret for webhook signing (if you configure)
TON_WEBHOOK_SECRET = os.getenv("TON_WEBHOOK_SECRET", "efc3aa4c35c1e12a09a3e40d9c7b9abf")

RAW_WHEEL = (
    [("blue",   2)] * 26 +
    [("pink",  30)] * 1  +
    [("yellow", 4)] * 10 +
    [("green",  3)] * 17
)
WHEEL = RAW_WHEEL[:]
random.shuffle(WHEEL)

COLOR_META = {
    "blue":   {"label": "Синий ×2",   "emoji":"🔵", "mult":2},
    "pink":   {"label": "Розовый ×30","emoji":"💖", "mult":30},
    "yellow": {"label": "Жёлтый ×4",  "emoji":"🟨", "mult":4},
    "green":  {"label": "Зелёный ×3", "emoji":"🟩", "mult":3},
}

app = FastAPI(title="Wheel Betting API (Auto TON + Admin whitelist)", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ====== DB ======
def now_str():
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with connect() as con:
        cur = con.cursor()
        cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            balance INTEGER NOT NULL DEFAULT 0,
            created_at TEXT
        )""")
        cur.execute("""
        CREATE TABLE IF NOT EXISTS rounds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            result_color TEXT,
            result_mult INTEGER,
            created_at TEXT
        )""")
        cur.execute("""
        CREATE TABLE IF NOT EXISTS bets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            round_id INTEGER,
            user_id INTEGER,
            username TEXT,
            color TEXT,
            amount INTEGER,
            created_at TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(round_id) REFERENCES rounds(id)
        )""")
        cur.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            username TEXT,
            delta INTEGER,
            reason TEXT,
            created_at TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )""")
        cur.execute("""
        CREATE TABLE IF NOT EXISTS deposits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            amount INTEGER,
            comment TEXT,
            status TEXT,
            created_at TEXT
        )""")
        con.commit()
init_db()

# ====== Telegram initData validation ======
def parse_init_data(init_data: str) -> Dict[str, str]:
    parsed = urllib.parse.parse_qsl(init_data, keep_blank_values=True)
    return {k: v for k, v in parsed}

def check_telegram_auth(init_data: str = Header(default="")) -> Dict[str, Any]:
    if not init_data:
        raise HTTPException(401, "Missing X-Telegram-Init-Data")
    if not TELEGRAM_BOT_TOKEN:
        raise HTTPException(500, "Server missing TELEGRAM_BOT_TOKEN")
    data = parse_init_data(init_data)
    if 'hash' not in data:
        raise HTTPException(401, "Missing hash")
    recv = data.pop('hash')
    pairs = [f"{k}={v}" for k, v in sorted(data.items())]
    check_string = "\n".join(pairs).encode()
    secret_key = hashlib.sha256(TELEGRAM_BOT_TOKEN.encode()).digest()
    h = hmac.new(secret_key, check_string, hashlib.sha256).hexdigest()
    if h != recv:
        raise HTTPException(401, "Bad hash")
    # extract username
    import json as _json
    username = None
    if 'user' in data:
        try:
            u = _json.loads(urllib.parse.unquote(data['user']))
            username = u.get('username') or f"id{u.get('id')}"
        except Exception:
            pass
    return {"username": username}

def is_admin_username(username: Optional[str]) -> bool:
    return bool(username) and username.lower() in ADMIN_WHITELIST

# ====== Helpers ======
def format_ton(nano: int) -> float:
    return round(nano / NANO, 9)

def get_or_create_user(username: str) -> sqlite3.Row:
    with connect() as con:
        cur = con.cursor()
        cur.execute("SELECT * FROM users WHERE username = ?", (username,))
        row = cur.fetchone()
        if row: return row
        cur.execute("INSERT INTO users (username, balance, created_at) VALUES (?, ?, ?)", (username, START_BALANCE, now_str()))
        con.commit()
        cur.execute("SELECT * FROM users WHERE username = ?", (username,))
        return cur.fetchone()

def add_tx(user_id: int, username: str, delta: int, reason: str):
    with connect() as con:
        cur = con.cursor()
        cur.execute("INSERT INTO transactions (user_id, username, delta, reason, created_at) VALUES (?, ?, ?, ?, ?)",
                    (user_id, username, delta, reason, now_str()))
        cur.execute("UPDATE users SET balance = balance + ? WHERE id = ?", (delta, user_id))
        con.commit()

def open_round(con) -> Optional[int]:
    cur = con.cursor()
    cur.execute("SELECT id FROM rounds WHERE result_color IS NULL ORDER BY id DESC LIMIT 1")
    r = cur.fetchone()
    return r["id"] if r else None

def ensure_open_round() -> int:
    with connect() as con:
        rid = open_round(con)
        if rid: return rid
        cur = con.cursor()
        cur.execute("INSERT INTO rounds (result_color, result_mult, created_at) VALUES (NULL, NULL, ?)", (now_str(),))
        con.commit()
        return cur.lastrowid

# ====== Schemas ======
class BetIn(BaseModel):
    color: str
    amount_ton: float

class ForceSpinIn(BaseModel):
    color: str

class CancelBetIn(BaseModel):
    bet_id: int

# ====== Public API ======
@app.get("/api/meta")
def meta():
    return {
        "segments": [{"color": c, "mult": m} for c, m in WHEEL],
        "colors": COLOR_META,
        "limits": {"min_ton": format_ton(MIN_BET), "max_ton": format_ton(MAX_BET)},
        "ton_wallet_address": TON_WALLET_ADDRESS,
    }

@app.get("/api/me")
def me(auth=Depends(check_telegram_auth)):
    username = auth["username"]
    return {"username": username, "is_admin": is_admin_username(username)}

@app.get("/api/state")
def state():
    with connect() as con:
        cur = con.cursor()
        cur.execute("SELECT username, balance FROM users ORDER BY username")
        users = [{"username": r["username"], "balance_ton": format_ton(r["balance"])} for r in cur.fetchall()]
        rid = open_round(con)
        bets = []
        if rid:
            cur.execute("SELECT id, username, color, amount, created_at FROM bets WHERE round_id = ? ORDER BY id", (rid,))
            bets = [{"id": r["id"], "username": r["username"], "color": r["color"], "amount_ton": format_ton(r["amount"]), "created_at": r["created_at"]} for r in cur.fetchall()]
        return {"users": users, "open_round_id": rid, "bets": bets}

@app.post("/api/bet")
def place_bet(bet: BetIn, auth=Depends(check_telegram_auth)):
    username = auth["username"]
    if not username:
        raise HTTPException(400, "Username required (open via Telegram)")
    if bet.color not in COLOR_META:
        raise HTTPException(400, "Unknown color")
    nano = int(bet.amount_ton * NANO)
    if nano < MIN_BET or nano > MAX_BET:
        raise HTTPException(400, "Bet out of limits")
    user = get_or_create_user(username)
    if user["balance"] < nano:
        raise HTTPException(400, "Insufficient balance")
    rid = ensure_open_round()
    with connect() as con:
        cur = con.cursor()
        cur.execute("INSERT INTO bets (round_id, user_id, username, color, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (rid, user["id"], username, bet.color, nano, now_str()))
        cur.execute("UPDATE users SET balance = balance - ? WHERE id = ?", (nano, user["id"]))
        cur.execute("INSERT INTO transactions (user_id, username, delta, reason, created_at) VALUES (?, ?, ?, ?, ?)",
                    (user["id"], username, -nano, f"bet:{bet.color}", now_str()))
        con.commit()
    return {"ok": True, "round_id": rid}

@app.post("/api/spin")
def spin():
    color, mult = random.choice(WHEEL)
    rid = ensure_open_round()
    with connect() as con:
        cur = con.cursor()
        cur.execute("SELECT id, user_id, username, color, amount FROM bets WHERE round_id = ?", (rid,))
        rows = cur.fetchall()
        total_bet = sum(r["amount"] for r in rows)
        winners, total_payout = [], 0
        for r in rows:
            if r["color"] == color:
                win = r["amount"] * mult
                winners.append({"username": r["username"], "amount_ton": format_ton(r["amount"]), "win_ton": format_ton(win)})
                cur.execute("UPDATE users SET balance = balance + ? WHERE id = ?", (win, r["user_id"]))
                cur.execute("INSERT INTO transactions (user_id, username, delta, reason, created_at) VALUES (?, ?, ?, ?, ?)",
                            (r["user_id"], r["username"], win, f"win:{color}x{mult}", now_str()))
                total_payout += win
        cur.execute("UPDATE rounds SET result_color = ?, result_mult = ? WHERE id = ?", (color, mult, rid))
        con.commit()
    return {"round_id": rid, "result_color": color, "result_mult": mult,
            "winners": winners, "total_bet_ton": format_ton(total_bet), "total_payout_ton": format_ton(total_payout)}

# ====== Admin via whitelist (Telegram) ======
def require_admin(auth=Depends(check_telegram_auth)):
    username = auth["username"]
    if not is_admin_username(username):
        raise HTTPException(403, "Not an admin")
    return username

@app.post("/api/admin/spin/force")
def admin_force_spin(body: ForceSpinIn, _admin=Depends(require_admin)):
    if body.color not in COLOR_META:
        raise HTTPException(400, "Unknown color")
    color, mult = body.color, COLOR_META[body.color]["mult"]
    rid = ensure_open_round()
    with connect() as con:
        cur = con.cursor()
        cur.execute("SELECT id, user_id, username, color, amount FROM bets WHERE round_id = ?", (rid,))
        rows = cur.fetchall()
        total_bet = sum(r["amount"] for r in rows)
        winners, total_payout = [], 0
        for r in rows:
            if r["color"] == color:
                win = r["amount"] * mult
                winners.append({"username": r["username"], "amount_ton": format_ton(r["amount"]), "win_ton": format_ton(win)})
                cur.execute("UPDATE users SET balance = balance + ? WHERE id = ?", (win, r["user_id"]))
                cur.execute("INSERT INTO transactions (user_id, username, delta, reason, created_at) VALUES (?, ?, ?, ?, ?)",
                            (r["user_id"], r["username"], win, f"win:{color}x{mult}", now_str()))
                total_payout += win
        cur.execute("UPDATE rounds SET result_color = ?, result_mult = ? WHERE id = ?", (color, mult, rid))
        con.commit()
    return {"round_id": rid, "result_color": color, "result_mult": mult,
            "winners": winners, "total_bet_ton": format_ton(total_bet), "total_payout_ton": format_ton(total_payout)}

@app.post("/api/admin/bet/cancel")
def admin_cancel_bet(body: CancelBetIn, _admin=Depends(require_admin)):
    with connect() as con:
        cur = con.cursor()
        rid = open_round(con)
        if not rid:
            raise HTTPException(400, "No open round")
        cur.execute("SELECT id, user_id, username, amount FROM bets WHERE id = ? AND round_id = ?", (body.bet_id, rid))
        b = cur.fetchone()
        if not b:
            raise HTTPException(404, "Bet not found in open round")
        cur.execute("UPDATE users SET balance = balance + ? WHERE id = ?", (b["amount"], b["user_id"]))
        cur.execute("INSERT INTO transactions (user_id, username, delta, reason, created_at) VALUES (?, ?, ?, ?, ?)",
                    (b["user_id"], b["username"], b["amount"], "cancel", now_str()))
        cur.execute("DELETE FROM bets WHERE id = ?", (body.bet_id,))
        con.commit()
    return {"ok": True}

# ====== TON deposits ======
@app.post("/api/ton/create_invoice")
def ton_create_invoice(amount_ton: float, auth=Depends(check_telegram_auth)):
    username = auth["username"]
    if amount_ton <= 0:
        raise HTTPException(400, "Amount must be positive")
    amount = int(amount_ton * NANO)
    comment = f"dep_{username}_{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}"
    with connect() as con:
        cur = con.cursor()
        cur.execute("INSERT INTO deposits (username, amount, comment, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
                    (username, amount, comment, now_str()))
        con.commit()
        dep_id = cur.lastrowid
    deeplink = f"ton://transfer/{TON_WALLET_ADDRESS}?amount={amount}&text={urllib.parse.quote(comment)}"
    return {"invoice_id": dep_id, "deeplink": deeplink, "comment": comment, "amount_ton": amount_ton, "address": TON_WALLET_ADDRESS}

@app.post("/api/ton/webhook")
async def ton_webhook(request: Request):
    # Generic webhook: expect JSON with {to_address, amount_nano, comment}. Optionally header X-Provider-Signature.
    # Validate address matches our wallet, find pending deposit by comment and same amount (±1%). Confirm and credit.
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON")
    to_addr = (data.get("to_address") or "").strip()
    amount = int(data.get("amount_nano") or 0)
    comment = (data.get("comment") or "").strip()
    if TON_WEBHOOK_SECRET:
        sig = request.headers.get("X-Webhook-Signature", "")
        if sig != TON_WEBHOOK_SECRET:
            raise HTTPException(401, "Bad webhook signature")
    if to_addr != TON_WALLET_ADDRESS:
        raise HTTPException(400, "Wrong address")
    if not comment or amount <= 0:
        raise HTTPException(400, "Bad payload")

    with connect() as con:
        cur = con.cursor()
        cur.execute("SELECT * FROM deposits WHERE comment = ? AND status = 'pending'", (comment,))
        dep = cur.fetchone()
        if not dep:
            # ignore unknown or already processed
            return {"ok": True, "msg": "no matching pending deposit"}
        # amount check within ±1%
        expected = dep["amount"]
        low = int(expected * 0.99)
        high = int(expected * 1.01)
        if not (low <= amount <= high):
            raise HTTPException(400, "Amount mismatch")
        # credit
        cur.execute("UPDATE deposits SET status = 'confirmed' WHERE id = ?", (dep["id"],))
        # ensure user exists
        cur.execute("SELECT * FROM users WHERE username = ?", (dep["username"],))
        u = cur.fetchone()
        if not u:
            cur.execute("INSERT INTO users (username, balance, created_at) VALUES (?, 0, ?)", (dep["username"], now_str()))
            cur.execute("SELECT * FROM users WHERE username = ?", (dep["username"],))
            u = cur.fetchone()
        cur.execute("UPDATE users SET balance = balance + ? WHERE id = ?", (dep["amount"], u["id"]))
        cur.execute("INSERT INTO transactions (user_id, username, delta, reason, created_at) VALUES (?, ?, ?, 'deposit:ton:webhook', ?)",
                    (u["id"], dep["username"], dep["amount"], now_str()))
        con.commit()
    return {"ok": True}

@app.get("/api/export/csv")
def export_csv():
    out_dir = os.getenv("EXPORT_DIR", "exports")
    os.makedirs(out_dir, exist_ok=True)
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    with connect() as con:
        cur = con.cursor()
        tables = {
            "users": ["id","username","balance","created_at"],
            "rounds": ["id","result_color","result_mult","created_at"],
            "bets": ["id","round_id","user_id","username","color","amount","created_at"],
            "transactions": ["id","user_id","username","delta","reason","created_at"],
            "deposits": ["id","username","amount","comment","status","created_at"],
        }
        out_files = []
        for t, defaults in tables.items():
            cur.execute(f"SELECT * FROM {t}")
            rows = [dict(r) for r in cur.fetchall()]
            path = os.path.join(out_dir, f"{t}_{ts}.csv")
            with open(path, "w", newline="", encoding="utf-8") as f:
                fields = list(rows[0].keys()) if rows else defaults
                w = csv.DictWriter(f, fieldnames=fields)
                w.writeheader()
                for r in rows: w.writerow(r)
            out_files.append(path)
    return {"ok": True, "files": out_files}

@app.get("/")
def root():
    return {"ok": True, "service": "wheel-api-auto"}
