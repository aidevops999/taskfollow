from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import mimetypes
import os
import secrets
import sqlite3
import struct
import sys
import time
from datetime import date, datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "data" / "sop.db"
STATIC_DIR = BASE_DIR / "static"
TEMPLATE_DIR = BASE_DIR / "templates"
VENDOR_DIR = BASE_DIR / "vendor"
SESSION_DAYS = 7
MAX_USERS = 10

if VENDOR_DIR.exists():
    sys.path.insert(0, str(VENDOR_DIR))

try:
    import qrcode
except ImportError:  # pragma: no cover - surfaced to the user via /api/otp-qr.
    qrcode = None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().replace(microsecond=0).isoformat()


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def row_to_dict(row: sqlite3.Row) -> dict:
    return {key: row[key] for key in row.keys()}


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 120_000)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        salt, expected = password_hash.split("$", 1)
    except ValueError:
        return False
    actual = hash_password(password, salt).split("$", 1)[1]
    return hmac.compare_digest(actual, expected)


def password_error(password: str) -> str | None:
    if len(password) < 8:
        return "密码至少 8 位，并且需要包含数字"
    if not any(ch.isdigit() for ch in password):
        return "密码至少 8 位，并且需要包含数字"
    return None


def generate_totp_secret() -> str:
    return base64.b32encode(os.urandom(20)).decode("ascii").rstrip("=")


def hotp(secret: str, counter: int) -> str:
    padded = secret + "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(padded, casefold=True)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{code % 1_000_000:06d}"


def totp(secret: str, timestamp: int | None = None) -> str:
    timestamp = timestamp or int(time.time())
    return hotp(secret, timestamp // 30)


def verify_totp(secret: str, code: str) -> bool:
    clean_code = "".join(ch for ch in code if ch.isdigit())
    if len(clean_code) != 6:
        return False
    current_counter = int(time.time()) // 30
    valid_codes = [hotp(secret, current_counter + offset) for offset in (-1, 0, 1)]
    return any(hmac.compare_digest(clean_code, valid_code) for valid_code in valid_codes)


def otpauth_url(username: str, secret: str) -> str:
    label = quote(f"TeamTaskSOP:{username}")
    issuer = quote("TeamTaskSOP")
    return f"otpauth://totp/{label}?secret={secret}&issuer={issuer}&digits=6&period=30"


def otp_qr_url(username: str, secret: str) -> str:
    return f"/api/otp-qr?username={quote(username)}&secret={quote(secret)}"


def month_week_ranges(month_start: date, next_month: date) -> list[dict]:
    ranges = []
    current = month_start
    index = 1
    while current < next_month:
        days_until_sunday = 6 - current.weekday()
        week_end = min(current + timedelta(days=days_until_sunday), next_month - timedelta(days=1))
        ranges.append(
            {
                "index": index,
                "start": current.isoformat(),
                "end": week_end.isoformat(),
                "label": f"第 {index} 周",
                "range": f"{current.strftime('%m/%d')}-{week_end.strftime('%m/%d')}",
            }
        )
        current = week_end + timedelta(days=1)
        index += 1
    return ranges


def init_db() -> None:
    DB_PATH.parent.mkdir(exist_ok=True)
    with get_connection() as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              username TEXT NOT NULL UNIQUE,
              display_name TEXT NOT NULL,
              password_hash TEXT NOT NULL,
              totp_secret TEXT NOT NULL,
              role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
              is_active INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS sessions (
              token TEXT PRIMARY KEY,
              user_id INTEGER NOT NULL,
              expires_at TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS tasks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              title TEXT NOT NULL,
              task_type TEXT NOT NULL CHECK (task_type IN ('week', 'month', 'year')),
              status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
              owner_id INTEGER NOT NULL,
              creator_id INTEGER NOT NULL,
              follower TEXT NOT NULL DEFAULT '',
              due_at TEXT,
              description TEXT NOT NULL DEFAULT '',
              priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
              work_note TEXT NOT NULL DEFAULT '',
              issue_note TEXT NOT NULL DEFAULT '',
              delay_reason TEXT NOT NULL DEFAULT '',
              completed_at TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
              FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS reminders (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL,
              title TEXT NOT NULL,
              due_at TEXT NOT NULL,
              remind_days INTEGER NOT NULL DEFAULT 15,
              note TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
              completed_at TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )
        ensure_task_columns(conn)
        ensure_user_columns(conn)
        ensure_reminder_columns(conn)

        if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
            admin_secret = generate_totp_secret()
            admin_password = os.environ.get("SOP_ADMIN_PASSWORD") or "Admin2026"
            conn.execute(
                """
                INSERT INTO users (username, display_name, password_hash, totp_secret, role, is_active)
                VALUES (?, ?, ?, ?, ?, 1)
                """,
                ("admin", "管理员", hash_password(admin_password), admin_secret, "admin"),
            )
            admin_id = conn.execute("SELECT id FROM users WHERE username = 'admin'").fetchone()[0]
            conn.executemany(
                """
                INSERT INTO tasks
                (title, task_type, status, owner_id, creator_id, follower, due_at, description)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        "梳理本周客户反馈问题",
                        "week",
                        "doing",
                        admin_id,
                        admin_id,
                        "管理员",
                        (utc_now() + timedelta(days=2)).date().isoformat(),
                        "把高频反馈归类，确认是否需要升级到产品改进项。",
                    ),
                    (
                        "完善问题处理 SOP 文档",
                        "month",
                        "todo",
                        admin_id,
                        admin_id,
                        "管理员",
                        None,
                        "持续补充分级规则、沟通模板和复盘字段。",
                    ),
                ],
            )
            print("已初始化默认管理员账号。请联系系统负责人获取首次登录信息。")


def ensure_task_columns(conn: sqlite3.Connection) -> None:
    migrate_task_type_schema(conn)
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()}
    migrations = {
        "follower": "ALTER TABLE tasks ADD COLUMN follower TEXT NOT NULL DEFAULT ''",
        "work_note": "ALTER TABLE tasks ADD COLUMN work_note TEXT NOT NULL DEFAULT ''",
        "issue_note": "ALTER TABLE tasks ADD COLUMN issue_note TEXT NOT NULL DEFAULT ''",
        "delay_reason": "ALTER TABLE tasks ADD COLUMN delay_reason TEXT NOT NULL DEFAULT ''",
        "completed_at": "ALTER TABLE tasks ADD COLUMN completed_at TEXT",
        "priority": "ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'",
    }
    for column, sql in migrations.items():
        if column not in columns:
            conn.execute(sql)
    conn.execute("UPDATE tasks SET priority = 'medium' WHERE priority NOT IN ('high', 'medium', 'low') OR priority IS NULL")
    conn.execute(
        """
        UPDATE tasks
        SET follower = COALESCE((SELECT display_name FROM users WHERE users.id = tasks.owner_id), '未填写')
        WHERE follower = ''
        """
    )


def ensure_user_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "role" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
    if "is_active" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")
    conn.execute("UPDATE users SET role = 'admin' WHERE username = 'admin'")
    conn.execute("UPDATE users SET role = 'user' WHERE role NOT IN ('user', 'admin')")
    conn.execute("UPDATE users SET is_active = 1 WHERE is_active IS NULL")


def ensure_reminder_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(reminders)").fetchall()}
    if "remind_days" not in columns:
        conn.execute("ALTER TABLE reminders ADD COLUMN remind_days INTEGER NOT NULL DEFAULT 15")


def migrate_task_type_schema(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'"
    ).fetchone()
    table_sql = row["sql"] or "" if row else ""
    if not row or ("'short', 'long'" not in table_sql and "'year'" in table_sql):
        return

    conn.executescript(
        """
        CREATE TABLE tasks_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          task_type TEXT NOT NULL CHECK (task_type IN ('week', 'month', 'year')),
          status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
          owner_id INTEGER NOT NULL,
          creator_id INTEGER NOT NULL,
          follower TEXT NOT NULL DEFAULT '',
          due_at TEXT,
          description TEXT NOT NULL DEFAULT '',
          priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
          work_note TEXT NOT NULL DEFAULT '',
          issue_note TEXT NOT NULL DEFAULT '',
          delay_reason TEXT NOT NULL DEFAULT '',
          completed_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
        );
        INSERT INTO tasks_new (
          id, title, task_type, status, owner_id, creator_id, follower, due_at,
          description, priority, work_note, issue_note, delay_reason, completed_at,
          created_at, updated_at
        )
        SELECT
          id,
          title,
          CASE task_type WHEN 'short' THEN 'week' WHEN 'long' THEN 'month' ELSE task_type END,
          status,
          owner_id,
          creator_id,
          '未填写',
          due_at,
          description,
          'medium',
          COALESCE(work_note, ''),
          COALESCE(issue_note, ''),
          COALESCE(delay_reason, ''),
          completed_at,
          created_at,
          updated_at
        FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_new RENAME TO tasks;
        """
    )


class AppHandler(BaseHTTPRequestHandler):
    server_version = "TeamTaskSOP/2.0"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/":
            self.send_file(TEMPLATE_DIR / "index.html", "text/html; charset=utf-8")
            return

        if path.startswith("/static/"):
            self.send_file(STATIC_DIR / path.removeprefix("/static/"))
            return

        if path == "/api/me":
            user = self.current_user()
            self.send_json({"user": self.public_user(user) if user else None})
            return

        if path == "/api/otp-qr":
            self.send_otp_qr(parsed.query)
            return

        if path == "/api/bootstrap":
            user = self.require_user()
            if not user:
                return
            self.send_json(
                {
                    "user": self.public_user(user),
                    "users": self.fetch_users(),
                    "tasks": self.fetch_tasks(self.task_scope_user_id(user, parsed.query), parsed.query),
                    "stats": self.fetch_stats(self.task_scope_user_id(user, parsed.query)),
                    "monthly": self.fetch_monthly_stats(self.task_scope_user_id(user, parsed.query), parsed.query),
                    "team_overview": self.fetch_team_overview() if self.is_admin(user) else [],
                    "reminders": self.fetch_reminders(user["id"]),
                }
            )
            return

        if path == "/api/tasks":
            user = self.require_user()
            if not user:
                return
            self.send_json(
                {
                    "tasks": self.fetch_tasks(self.task_scope_user_id(user, parsed.query), parsed.query),
                    "stats": self.fetch_stats(self.task_scope_user_id(user, parsed.query)),
                    "monthly": self.fetch_monthly_stats(self.task_scope_user_id(user, parsed.query), parsed.query),
                    "team_overview": self.fetch_team_overview() if self.is_admin(user) else [],
                }
            )
            return

        if path == "/api/reminders":
            user = self.require_user()
            if not user:
                return
            self.send_json({"reminders": self.fetch_reminders(user["id"])})
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/register":
            self.register()
            return

        if parsed.path == "/api/login":
            self.login()
            return

        if parsed.path == "/api/reset-otp":
            self.reset_otp()
            return

        if parsed.path == "/api/logout":
            self.logout()
            return

        if parsed.path == "/api/change-password":
            user = self.require_user()
            if not user:
                return
            self.change_password(user)
            return

        if parsed.path == "/api/tasks":
            user = self.require_user()
            if not user:
                return
            self.create_task(user)
            return

        if parsed.path == "/api/users/role":
            user = self.require_user()
            if not user:
                return
            self.update_user_role(user)
            return

        if parsed.path == "/api/users/delete":
            user = self.require_user()
            if not user:
                return
            self.delete_user(user)
            return

        if parsed.path == "/api/reminders":
            user = self.require_user()
            if not user:
                return
            self.create_reminder(user)
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_PATCH(self) -> None:
        user = self.require_user()
        if not user:
            return

        parsed_path = urlparse(self.path).path
        reminder_id = self.reminder_id_from_path(parsed_path)
        if reminder_id is not None:
            self.update_reminder(user, reminder_id)
            return

        task_id = self.task_id_from_path(parsed_path)
        if task_id is None:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return

        payload = self.read_json()
        allowed = {"status", "work_note", "issue_note", "delay_reason", "due_at"}
        updates = {key: value for key, value in payload.items() if key in allowed}
        if not updates:
            self.send_json({"error": "没有可更新字段"}, HTTPStatus.BAD_REQUEST)
            return

        if "due_at" in updates:
            due_at = self.clean_due_date(str(updates["due_at"]).strip())
            if not due_at:
                self.send_json({"error": "计划完成时间格式不正确"}, HTTPStatus.BAD_REQUEST)
                return
            if due_at < utc_now().date().isoformat() and updates.get("status") != "done":
                self.send_json({"error": "计划完成时间不能早于今天"}, HTTPStatus.BAD_REQUEST)
                return
            updates["due_at"] = due_at
        if "status" in updates and updates["status"] not in {"todo", "doing", "done"}:
            self.send_json({"error": "任务状态不正确"}, HTTPStatus.BAD_REQUEST)
            return
        if updates.get("status") == "done":
            updates["completed_at"] = iso_now()
        elif updates.get("status") in {"todo", "doing"}:
            updates["completed_at"] = None

        assignments = ", ".join(f"{key} = ?" for key in updates)
        values = list(updates.values()) + [iso_now(), task_id, user["id"], user["id"]]
        with get_connection() as conn:
            result = conn.execute(
                f"""
                UPDATE tasks
                SET {assignments}, updated_at = ?
                WHERE id = ? AND (owner_id = ? OR creator_id = ?)
                """,
                values,
            )
            if result.rowcount == 0:
                self.send_json({"error": "没有权限更新该任务"}, HTTPStatus.FORBIDDEN)
                return

        self.send_json(
            {
                "tasks": self.fetch_tasks(user["id"], ""),
                "stats": self.fetch_stats(user["id"]),
                "monthly": self.fetch_monthly_stats(user["id"], ""),
            }
        )

    def do_DELETE(self) -> None:
        user = self.require_user()
        if not user:
            return

        parsed_path = urlparse(self.path).path
        reminder_id = self.reminder_id_from_path(parsed_path)
        if reminder_id is not None:
            with get_connection() as conn:
                result = conn.execute("DELETE FROM reminders WHERE id = ? AND user_id = ?", (reminder_id, user["id"]))
                if result.rowcount == 0:
                    self.send_json({"error": "没有权限删除该提醒"}, HTTPStatus.FORBIDDEN)
                    return
            self.send_json({"reminders": self.fetch_reminders(user["id"])})
            return

        task_id = self.task_id_from_path(parsed_path)
        if task_id is None:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return

        with get_connection() as conn:
            task = conn.execute("SELECT id, creator_id FROM tasks WHERE id = ?", (task_id,)).fetchone()
            if not task:
                self.send_json({"error": "任务不存在"}, HTTPStatus.NOT_FOUND)
                return
            if not self.is_admin(user) and task["creator_id"] != user["id"]:
                self.send_json({"error": "只有管理员或任务创建人可以删除该任务"}, HTTPStatus.FORBIDDEN)
                return

            conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))

        self.send_json(
            {
                "tasks": self.fetch_tasks(user["id"], ""),
                "stats": self.fetch_stats(user["id"]),
                "monthly": self.fetch_monthly_stats(user["id"], ""),
            }
        )

    def register(self) -> None:
        payload = self.read_json()
        username = str(payload.get("username", "")).strip()
        display_name = str(payload.get("display_name", "")).strip() or username
        password = str(payload.get("password", ""))

        if not username or not password:
            self.send_json({"error": "用户名和密码不能为空"}, HTTPStatus.BAD_REQUEST)
            return
        error = password_error(password)
        if error:
            self.send_json({"error": error}, HTTPStatus.BAD_REQUEST)
            return

        with get_connection() as conn:
            if conn.execute("SELECT COUNT(*) FROM users WHERE is_active = 1").fetchone()[0] >= MAX_USERS:
                self.send_json({"error": "用户数已达 10 人上限"}, HTTPStatus.BAD_REQUEST)
                return
            if conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
                self.send_json({"error": "用户名已存在"}, HTTPStatus.BAD_REQUEST)
                return

            secret = generate_totp_secret()
            conn.execute(
                """
                INSERT INTO users (username, display_name, password_hash, totp_secret, role, is_active)
                VALUES (?, ?, ?, ?, 'user', 1)
                """,
                (username, display_name, hash_password(password), secret),
            )

        self.send_json(
            {
                "message": "注册成功，请保存二次验证密钥",
                "totp_secret": secret,
                "current_code": totp(secret),
                "otpauth_url": otpauth_url(username, secret),
                "qr_url": otp_qr_url(username, secret),
            },
            HTTPStatus.CREATED,
        )

    def delete_user(self, admin_user: sqlite3.Row) -> None:
        if not self.is_admin(admin_user):
            self.send_json({"error": "只有管理员可以删除用户"}, HTTPStatus.FORBIDDEN)
            return

        payload = self.read_json()
        user_id = int(payload.get("user_id") or 0)
        if user_id == admin_user["id"]:
            self.send_json({"error": "不能删除当前登录的管理员账号"}, HTTPStatus.BAD_REQUEST)
            return

        with get_connection() as conn:
            target = conn.execute(
                "SELECT id, role, is_active FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            if not target or not target["is_active"]:
                self.send_json({"error": "用户不存在或已删除"}, HTTPStatus.NOT_FOUND)
                return
            if target["role"] == "admin":
                active_admins = conn.execute(
                    "SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = 1"
                ).fetchone()[0]
                if active_admins <= 1:
                    self.send_json({"error": "至少需要保留一个管理员"}, HTTPStatus.BAD_REQUEST)
                    return

            conn.execute("UPDATE users SET is_active = 0 WHERE id = ?", (user_id,))
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))

        self.send_json({"users": self.fetch_users(), "team_overview": self.fetch_team_overview()})

    def update_user_role(self, admin_user: sqlite3.Row) -> None:
        if not self.is_admin(admin_user):
            self.send_json({"error": "只有管理员可以修改用户权限"}, HTTPStatus.FORBIDDEN)
            return

        payload = self.read_json()
        user_id = int(payload.get("user_id") or 0)
        role = str(payload.get("role", "")).strip()
        if role not in {"user", "admin"}:
            self.send_json({"error": "角色不正确"}, HTTPStatus.BAD_REQUEST)
            return
        if user_id == admin_user["id"] and role != "admin":
            self.send_json({"error": "不能取消自己的管理员权限"}, HTTPStatus.BAD_REQUEST)
            return

        with get_connection() as conn:
            result = conn.execute("UPDATE users SET role = ? WHERE id = ? AND is_active = 1", (role, user_id))
            if result.rowcount == 0:
                self.send_json({"error": "用户不存在"}, HTTPStatus.NOT_FOUND)
                return

        self.send_json({"users": self.fetch_users(), "team_overview": self.fetch_team_overview()})

    def login(self) -> None:
        payload = self.read_json()
        username = str(payload.get("username", "")).strip()
        password = str(payload.get("password", ""))
        otp_code = str(payload.get("otp", ""))

        with get_connection() as conn:
            row = conn.execute("SELECT * FROM users WHERE username = ? AND is_active = 1", (username,)).fetchone()

        if not row or not verify_password(password, row["password_hash"]):
            self.send_json({"error": "用户名或密码不正确"}, HTTPStatus.UNAUTHORIZED)
            return
        if not verify_totp(row["totp_secret"], otp_code):
            self.send_json({"error": "二次验证码不正确或已过期"}, HTTPStatus.UNAUTHORIZED)
            return

        token = secrets.token_urlsafe(32)
        expires_at = utc_now() + timedelta(days=SESSION_DAYS)
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
                (token, row["id"], expires_at.replace(microsecond=0).isoformat()),
            )

        self.send_json({"user": self.public_user(row)}, cookie_token=token, cookie_expires=expires_at)

    def reset_otp(self) -> None:
        payload = self.read_json()
        username = str(payload.get("username", "")).strip()
        password = str(payload.get("password", ""))

        with get_connection() as conn:
            row = conn.execute("SELECT * FROM users WHERE username = ? AND is_active = 1", (username,)).fetchone()
            if not row or not verify_password(password, row["password_hash"]):
                self.send_json({"error": "用户名或密码不正确"}, HTTPStatus.UNAUTHORIZED)
                return

            secret = generate_totp_secret()
            conn.execute("UPDATE users SET totp_secret = ? WHERE id = ?", (secret, row["id"]))
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))

        self.send_json(
            {
                "message": "Google Authenticator 密钥已重置",
                "totp_secret": secret,
                "current_code": totp(secret),
                "otpauth_url": otpauth_url(username, secret),
                "qr_url": otp_qr_url(username, secret),
            }
        )

    def change_password(self, user: sqlite3.Row) -> None:
        payload = self.read_json()
        current_password = str(payload.get("current_password", ""))
        new_password = str(payload.get("new_password", ""))
        confirm_password = str(payload.get("confirm_password", ""))

        if not verify_password(current_password, user["password_hash"]):
            self.send_json({"error": "当前密码不正确"}, HTTPStatus.UNAUTHORIZED)
            return
        if new_password != confirm_password:
            self.send_json({"error": "两次输入的新密码不一致"}, HTTPStatus.BAD_REQUEST)
            return
        error = password_error(new_password)
        if error:
            self.send_json({"error": error}, HTTPStatus.BAD_REQUEST)
            return

        with get_connection() as conn:
            conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new_password), user["id"]))
            token = self.session_token()
            if token:
                conn.execute("DELETE FROM sessions WHERE user_id = ? AND token != ?", (user["id"], token))

        self.send_json({"message": "密码已修改"})

    def logout(self) -> None:
        token = self.session_token()
        if token:
            with get_connection() as conn:
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Set-Cookie", "sop_session=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly")
        self.end_headers()

    def create_task(self, user: sqlite3.Row) -> None:
        payload = self.read_json()
        title = str(payload.get("title", "")).strip()
        task_type = str(payload.get("task_type", "week")).strip()
        status = str(payload.get("status", "todo")).strip()
        owner_id = int(payload.get("owner_id") or user["id"])
        follower = str(payload.get("follower", "")).strip()
        due_at = self.clean_due_date(str(payload.get("due_at", "")).strip())
        priority = str(payload.get("priority", "medium")).strip()
        description = str(payload.get("description", "")).strip()

        if not title:
            self.send_json({"error": "任务标题不能为空"}, HTTPStatus.BAD_REQUEST)
            return
        if task_type not in {"week", "month", "year"}:
            self.send_json({"error": "任务类型不正确"}, HTTPStatus.BAD_REQUEST)
            return
        if status not in {"todo", "doing", "done"}:
            self.send_json({"error": "任务状态不正确"}, HTTPStatus.BAD_REQUEST)
            return
        if priority not in {"high", "medium", "low"}:
            self.send_json({"error": "优先级不正确"}, HTTPStatus.BAD_REQUEST)
            return
        if not follower:
            self.send_json({"error": "跟进人不能为空"}, HTTPStatus.BAD_REQUEST)
            return
        if not due_at:
            self.send_json({"error": "任务需要填写计划完成时间"}, HTTPStatus.BAD_REQUEST)
            return
        if due_at < utc_now().date().isoformat():
            self.send_json({"error": "计划完成时间不能早于今天"}, HTTPStatus.BAD_REQUEST)
            return

        with get_connection() as conn:
            if not conn.execute("SELECT 1 FROM users WHERE id = ?", (owner_id,)).fetchone():
                self.send_json({"error": "负责人不存在"}, HTTPStatus.BAD_REQUEST)
                return
            conn.execute(
                """
                INSERT INTO tasks
                (title, task_type, status, owner_id, creator_id, follower, due_at, priority, description)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (title, task_type, status, owner_id, user["id"], follower, due_at, priority, description),
            )

        self.send_json(
            {
                "tasks": self.fetch_tasks(user["id"], ""),
                "stats": self.fetch_stats(user["id"]),
                "monthly": self.fetch_monthly_stats(user["id"], ""),
            },
            HTTPStatus.CREATED,
        )

    def clean_due_date(self, value: str) -> str | None:
        if not value:
            return None
        try:
            return datetime.strptime(value[:10], "%Y-%m-%d").date().isoformat()
        except ValueError:
            return None

    def reminder_id_from_path(self, path: str) -> int | None:
        parts = path.strip("/").split("/")
        if len(parts) == 3 and parts[:2] == ["api", "reminders"] and parts[2].isdigit():
            return int(parts[2])
        return None

    def task_id_from_path(self, path: str) -> int | None:
        parts = path.strip("/").split("/")
        if len(parts) == 3 and parts[:2] == ["api", "tasks"] and parts[2].isdigit():
            return int(parts[2])
        return None

    def create_reminder(self, user: sqlite3.Row) -> None:
        payload = self.read_json()
        title = str(payload.get("title", "")).strip()
        due_at = self.clean_due_date(str(payload.get("due_at", "")).strip())
        remind_days = int(payload.get("remind_days") or 15)
        note = str(payload.get("note", "")).strip()
        today = utc_now().date().isoformat()

        if not title:
            self.send_json({"error": "提醒事项不能为空"}, HTTPStatus.BAD_REQUEST)
            return
        if not due_at:
            self.send_json({"error": "截止时间格式不正确"}, HTTPStatus.BAD_REQUEST)
            return
        if due_at < today:
            self.send_json({"error": "截止时间不能早于今天"}, HTTPStatus.BAD_REQUEST)
            return
        if remind_days < 1 or remind_days > 180:
            self.send_json({"error": "提前提醒天数需要在 1 到 180 天之间"}, HTTPStatus.BAD_REQUEST)
            return

        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO reminders (user_id, title, due_at, remind_days, note)
                VALUES (?, ?, ?, ?, ?)
                """,
                (user["id"], title, due_at, remind_days, note),
            )

        self.send_json({"reminders": self.fetch_reminders(user["id"])}, HTTPStatus.CREATED)

    def update_reminder(self, user: sqlite3.Row, reminder_id: int) -> None:
        payload = self.read_json()
        status = str(payload.get("status", "")).strip()
        if status not in {"open", "done"}:
            self.send_json({"error": "提醒状态不正确"}, HTTPStatus.BAD_REQUEST)
            return

        completed_at = iso_now() if status == "done" else None
        with get_connection() as conn:
            result = conn.execute(
                """
                UPDATE reminders
                SET status = ?, completed_at = ?, updated_at = ?
                WHERE id = ? AND user_id = ?
                """,
                (status, completed_at, iso_now(), reminder_id, user["id"]),
            )
            if result.rowcount == 0:
                self.send_json({"error": "没有权限更新该提醒"}, HTTPStatus.FORBIDDEN)
                return

        self.send_json({"reminders": self.fetch_reminders(user["id"])})

    def fetch_reminders(self, user_id: int) -> list[dict]:
        today_date = utc_now().date()
        with get_connection() as conn:
            rows = conn.execute(
                """
                SELECT * FROM reminders
                WHERE user_id = ?
                ORDER BY
                  CASE status WHEN 'open' THEN 0 ELSE 1 END,
                  due_at ASC,
                  updated_at DESC
                """,
                (user_id,),
            ).fetchall()

        reminders = []
        for row in rows:
            item = row_to_dict(row)
            due_date = datetime.strptime(item["due_at"], "%Y-%m-%d").date()
            remind_date = due_date - timedelta(days=int(item.get("remind_days") or 15))
            item["remind_at"] = remind_date.isoformat()
            item["days_left"] = (due_date - today_date).days
            item["is_due_soon"] = item["status"] == "open" and remind_date <= today_date <= due_date
            item["is_overdue"] = item["status"] == "open" and due_date < today_date
            reminders.append(item)
        return reminders

    def fetch_users(self) -> list[dict]:
        with get_connection() as conn:
            rows = conn.execute("SELECT id, username, display_name, role, is_active FROM users WHERE is_active = 1 ORDER BY display_name").fetchall()
        return [row_to_dict(row) for row in rows]

    def task_scope_user_id(self, user: sqlite3.Row, query: str) -> int:
        filters = parse_qs(query)
        owner_id = filters.get("owner_id", [""])[0]
        if not self.is_admin(user) or not owner_id.isdigit():
            return user["id"]

        with get_connection() as conn:
            row = conn.execute("SELECT id FROM users WHERE id = ?", (int(owner_id),)).fetchone()
        return row["id"] if row else user["id"]

    def fetch_tasks(self, user_id: int, query: str) -> list[dict]:
        filters = parse_qs(query)
        status = filters.get("status", ["all"])[0]
        task_type = filters.get("type", ["all"])[0]
        keyword = filters.get("q", [""])[0].strip()
        delayed_only = filters.get("delayed", ["0"])[0] == "1"
        due_start = self.clean_due_date(filters.get("due_start", [""])[0])
        due_end = self.clean_due_date(filters.get("due_end", [""])[0])
        clauses = ["tasks.owner_id = ?"]
        values: list[object] = [user_id]
        today = utc_now().date().isoformat()

        if status != "all":
            clauses.append("tasks.status = ?")
            values.append(status)
        if task_type != "all":
            clauses.append("tasks.task_type = ?")
            values.append(task_type)
        if keyword:
            clauses.append("(tasks.title LIKE ? OR tasks.description LIKE ? OR tasks.work_note LIKE ? OR tasks.issue_note LIKE ? OR tasks.delay_reason LIKE ?)")
            like = f"%{keyword}%"
            values.extend([like, like, like, like, like])
        if delayed_only:
            clauses.append("tasks.status != 'done'")
            clauses.append("tasks.due_at IS NOT NULL")
            clauses.append("tasks.due_at < ?")
            values.append(today)
        if due_start:
            clauses.append("tasks.due_at IS NOT NULL")
            clauses.append("tasks.due_at >= ?")
            values.append(due_start)
        if due_end:
            clauses.append("tasks.due_at IS NOT NULL")
            clauses.append("tasks.due_at <= ?")
            values.append(due_end)

        with get_connection() as conn:
            rows = conn.execute(
                f"""
                SELECT
                  tasks.*,
                  owner.display_name AS owner_name,
                  creator.display_name AS creator_name
                FROM tasks
                JOIN users owner ON owner.id = tasks.owner_id
                JOIN users creator ON creator.id = tasks.creator_id
                WHERE {' AND '.join(clauses)}
                ORDER BY
                  CASE tasks.status
                    WHEN 'doing' THEN 0
                    WHEN 'todo' THEN 1
                    ELSE 2
                  END,
                  CASE tasks.priority
                    WHEN 'high' THEN 0
                    WHEN 'medium' THEN 1
                    ELSE 2
                  END,
                  CASE WHEN tasks.due_at IS NULL THEN 1 ELSE 0 END,
                  tasks.due_at ASC,
                  tasks.updated_at DESC
                """,
                tuple(values),
            ).fetchall()
        tasks = []
        for row in rows:
            task = row_to_dict(row)
            task["is_delayed"] = bool(
                task["task_type"] in {"week", "month", "year"}
                and task["status"] != "done"
                and task["due_at"]
                and task["due_at"] < today
            )
            tasks.append(task)
        return tasks

    def fetch_stats(self, user_id: int) -> dict:
        today = utc_now().date().isoformat()
        with get_connection() as conn:
            total = conn.execute("SELECT COUNT(*) FROM tasks WHERE owner_id = ?", (user_id,)).fetchone()[0]
            week = conn.execute(
                "SELECT COUNT(*) FROM tasks WHERE owner_id = ? AND task_type = 'week'",
                (user_id,),
            ).fetchone()[0]
            month = conn.execute(
                "SELECT COUNT(*) FROM tasks WHERE owner_id = ? AND task_type = 'month'",
                (user_id,),
            ).fetchone()[0]
            year = conn.execute(
                "SELECT COUNT(*) FROM tasks WHERE owner_id = ? AND task_type = 'year'",
                (user_id,),
            ).fetchone()[0]
            done = conn.execute(
                "SELECT COUNT(*) FROM tasks WHERE owner_id = ? AND status = 'done'",
                (user_id,),
            ).fetchone()[0]
            delayed = conn.execute(
                """
                SELECT COUNT(*) FROM tasks
                WHERE owner_id = ?
                  AND status != 'done'
                  AND due_at IS NOT NULL
                  AND due_at < ?
                """,
                (user_id, today),
            ).fetchone()[0]
        return {"total": total, "week": week, "month": month, "year": year, "done": done, "delayed": delayed}

    def fetch_monthly_stats(self, user_id: int, query: str) -> dict:
        filters = parse_qs(query)
        month = filters.get("month", [utc_now().strftime("%Y-%m")])[0]
        try:
            start = datetime.strptime(month, "%Y-%m").date()
        except ValueError:
            start = utc_now().date().replace(day=1)
            month = start.strftime("%Y-%m")

        if start.month == 12:
            next_month = start.replace(year=start.year + 1, month=1)
        else:
            next_month = start.replace(month=start.month + 1)

        start_text = start.isoformat()
        end_text = next_month.isoformat()
        today = utc_now().date().isoformat()
        with get_connection() as conn:
            assigned = conn.execute(
                """
                SELECT COUNT(*) FROM tasks
                WHERE owner_id = ?
                  AND created_at >= ?
                  AND created_at < ?
                """,
                (user_id, start_text, end_text),
            ).fetchone()[0]
            due = conn.execute(
                """
                SELECT COUNT(*) FROM tasks
                WHERE owner_id = ?
                  AND due_at IS NOT NULL
                  AND due_at >= ?
                  AND due_at < ?
                """,
                (user_id, start_text, end_text),
            ).fetchone()[0]
            completed = conn.execute(
                """
                SELECT COUNT(*) FROM tasks
                WHERE owner_id = ?
                  AND completed_at IS NOT NULL
                  AND completed_at >= ?
                  AND completed_at < ?
                """,
                (user_id, start_text, end_text),
            ).fetchone()[0]
            delayed = conn.execute(
                """
                SELECT COUNT(*) FROM tasks
                WHERE owner_id = ?
                  AND due_at IS NOT NULL
                  AND due_at >= ?
                  AND due_at < ?
                  AND (
                    (status != 'done' AND due_at < ?)
                    OR (completed_at IS NOT NULL AND date(completed_at) > due_at)
                  )
                """,
                (user_id, start_text, end_text, today),
            ).fetchone()[0]
            weeks = []
            for week in month_week_ranges(start, next_month):
                week_start = week["start"]
                week_end_exclusive = (datetime.strptime(week["end"], "%Y-%m-%d").date() + timedelta(days=1)).isoformat()
                week_due = conn.execute(
                    """
                    SELECT COUNT(*) FROM tasks
                    WHERE owner_id = ?
                      AND due_at IS NOT NULL
                      AND due_at >= ?
                      AND due_at < ?
                    """,
                    (user_id, week_start, week_end_exclusive),
                ).fetchone()[0]
                week_completed = conn.execute(
                    """
                    SELECT COUNT(*) FROM tasks
                    WHERE owner_id = ?
                      AND completed_at IS NOT NULL
                      AND completed_at >= ?
                      AND completed_at < ?
                    """,
                    (user_id, week_start, week_end_exclusive),
                ).fetchone()[0]
                week_delayed = conn.execute(
                    """
                    SELECT COUNT(*) FROM tasks
                    WHERE owner_id = ?
                      AND due_at IS NOT NULL
                      AND due_at >= ?
                      AND due_at < ?
                      AND (
                        (status != 'done' AND due_at < ?)
                        OR (completed_at IS NOT NULL AND date(completed_at) > due_at)
                      )
                    """,
                    (user_id, week_start, week_end_exclusive, today),
                ).fetchone()[0]
                week["due"] = week_due
                week["completed"] = week_completed
                week["delayed"] = week_delayed
                week["rate"] = round((week_completed / week_due) * 100) if week_due else 0
                weeks.append(week)

        rate = round((completed / due) * 100) if due else 0
        return {
            "month": month,
            "assigned": assigned,
            "due": due,
            "completed": completed,
            "delayed": delayed,
            "rate": rate,
            "weeks": weeks,
        }

    def fetch_team_overview(self) -> list[dict]:
        today = utc_now().date().isoformat()
        with get_connection() as conn:
            rows = conn.execute(
                """
                SELECT
                  users.id AS user_id,
                  users.display_name,
                  users.is_active,
                  COUNT(tasks.id) AS total,
                  SUM(CASE WHEN tasks.task_type = 'week' THEN 1 ELSE 0 END) AS week,
                  SUM(CASE WHEN tasks.task_type = 'month' THEN 1 ELSE 0 END) AS month,
                  SUM(CASE WHEN tasks.task_type = 'year' THEN 1 ELSE 0 END) AS year,
                  SUM(CASE WHEN tasks.status = 'doing' THEN 1 ELSE 0 END) AS doing,
                  SUM(CASE WHEN tasks.status = 'done' THEN 1 ELSE 0 END) AS done,
                  SUM(
                    CASE
                      WHEN tasks.status != 'done'
                       AND tasks.due_at IS NOT NULL
                       AND tasks.due_at < ?
                      THEN 1 ELSE 0
                    END
                  ) AS delayed
                FROM users
                LEFT JOIN tasks ON tasks.owner_id = users.id
                GROUP BY users.id, users.display_name, users.is_active
                HAVING users.is_active = 1 OR COUNT(tasks.id) > 0
                ORDER BY total DESC, delayed DESC, users.display_name ASC
                """,
                (today,),
            ).fetchall()

        overview = []
        for row in rows:
            item = row_to_dict(row)
            total = item["total"] or 0
            done = item["done"] or 0
            item["completion_rate"] = round((done / total) * 100) if total else 0
            overview.append(item)
        return overview

    def public_user(self, user: sqlite3.Row) -> dict:
        return {"id": user["id"], "username": user["username"], "display_name": user["display_name"], "role": user["role"]}

    def is_admin(self, user: sqlite3.Row) -> bool:
        return user["role"] == "admin"

    def current_user(self) -> sqlite3.Row | None:
        token = self.session_token()
        if not token:
            return None
        with get_connection() as conn:
            row = conn.execute(
                """
                SELECT users.*
                FROM sessions
                JOIN users ON users.id = sessions.user_id
                WHERE sessions.token = ? AND sessions.expires_at > ? AND users.is_active = 1
                """,
                (token, iso_now()),
            ).fetchone()
        return row

    def require_user(self) -> sqlite3.Row | None:
        user = self.current_user()
        if not user:
            self.send_json({"error": "请先登录"}, HTTPStatus.UNAUTHORIZED)
            return None
        return user

    def session_token(self) -> str | None:
        cookie = SimpleCookie(self.headers.get("Cookie"))
        morsel = cookie.get("sop_session")
        return morsel.value if morsel else None

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {}

    def send_json(
        self,
        payload: dict,
        status: HTTPStatus = HTTPStatus.OK,
        cookie_token: str | None = None,
        cookie_expires: datetime | None = None,
    ) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        if cookie_token and cookie_expires:
            self.send_header_cookie(cookie_token, cookie_expires)
        self.end_headers()
        self.wfile.write(data)

    def send_otp_qr(self, query: str) -> None:
        if qrcode is None:
            self.send_json({"error": "缺少 qrcode 库，请先安装 vendor/qrcode"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        params = parse_qs(query)
        username = (params.get("username") or [""])[0].strip()
        secret = (params.get("secret") or [""])[0].strip().replace(" ", "").upper()

        if not username or not secret:
            self.send_error(HTTPStatus.BAD_REQUEST, "Missing username or secret")
            return

        try:
            base64.b32decode(secret + "=" * ((8 - len(secret) % 8) % 8), casefold=True)
        except Exception:
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid secret")
            return

        from qrcode.image.svg import SvgPathImage

        image = qrcode.make(otpauth_url(username, secret), image_factory=SvgPathImage)
        data = image.to_string()

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "image/svg+xml; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_header_cookie(self, token: str, expires_at: datetime) -> None:
        cookie = f"sop_session={token}; Path=/; SameSite=Lax; HttpOnly; Expires={expires_at.strftime('%a, %d %b %Y %H:%M:%S GMT')}"
        self.send_header("Set-Cookie", cookie)

    def send_file(self, target: Path, content_type: str | None = None) -> None:
        if not target.exists() or not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return
        guessed_type = content_type or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        data = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", guessed_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    init_db()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(("127.0.0.1", port), AppHandler)
    print(f"小团队任务 SOP 系统已启动：http://127.0.0.1:{port}")
    print("按 Ctrl+C 停止服务")
    server.serve_forever()


if __name__ == "__main__":
    main()
