from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable


_BINDING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_BINDING_CODE_LENGTH = 16
_BINDING_TTL_SECONDS = 5 * 60
_SESSION_TTL_SECONDS = 8 * 60 * 60
_SCRYPT_N = 131072
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_DKLEN = 32
_SCRYPT_MAXMEM = 256 * 1024 * 1024
_MIN_PASSWORD_LENGTH = 6
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


@dataclass(frozen=True)
class Registration:
    code: str
    expires_at: float


@dataclass(frozen=True)
class WebSession:
    token: str
    user_id: str
    email: str
    csrf_token: str
    expires_at: float


class WebAuthService:
    def __init__(
        self,
        *,
        users_path: Path,
        runtime_path: Path,
        now: Callable[[], float] = time.time,
    ) -> None:
        self._users_path = Path(users_path)
        self._runtime_path = Path(runtime_path)
        self._now = now
        self._lock = threading.RLock()

    @staticmethod
    def normalize_email(value: str) -> str:
        email = str(value or "").strip().casefold()
        if not _EMAIL_RE.fullmatch(email):
            raise ValueError("invalid email")
        return email

    @staticmethod
    def validate_password(value: str) -> str:
        password = str(value or "")
        if len(password) < _MIN_PASSWORD_LENGTH:
            raise ValueError(f"password must be at least {_MIN_PASSWORD_LENGTH} characters")
        return password

    def register(self, *, email: str, password: str) -> Registration:
        normalized_email = self.normalize_email(email)
        secret = self.validate_password(password)
        with self._lock:
            now = self._now()
            users = self._load_users()
            runtime = self._load_runtime()
            self._cleanup_runtime(runtime, now)
            if self._find_user_by_email(users, normalized_email) is not None:
                raise ValueError("email already registered")
            runtime["pending_registrations"] = [
                entry
                for entry in runtime["pending_registrations"]
                if entry.get("email") != normalized_email
            ]
            code = self._new_code(runtime)
            code_salt = os.urandom(16)
            password_salt = os.urandom(16)
            runtime["pending_registrations"].append(
                {
                    "user_id": f"cwu_{secrets.token_urlsafe(18)}",
                    "email": normalized_email,
                    "password": self._password_record(secret, password_salt),
                    "code_hash": self._code_hash(code, code_salt),
                    "code_salt": self._encode(code_salt),
                    "created_at": now,
                    "expires_at": now + _BINDING_TTL_SECONDS,
                }
            )
            self._save_runtime(runtime)
            return Registration(code=code, expires_at=now + _BINDING_TTL_SECONDS)

    def consume_feishu_binding(
        self,
        *,
        code: str,
        union_id: str | None,
        user_id: str | None,
        open_id: str | None,
    ) -> dict[str, Any] | None:
        identities = self._identities(union_id=union_id, user_id=user_id, open_id=open_id)
        if not identities:
            return None
        with self._lock:
            now = self._now()
            users = self._load_users()
            runtime = self._load_runtime()
            self._cleanup_runtime(runtime, now)
            pending = self._take_pending(runtime, code)
            if pending is None:
                self._save_runtime(runtime)
                return None
            if self._find_user_for_identity(users, identities) is not None:
                self._save_runtime(runtime)
                return None
            account = {
                "user_id": pending["user_id"],
                "email": pending["email"],
                "password": pending["password"],
                "feishu": self._feishu_record(identities),
                "status": "active",
                "created_at": self._iso(pending["created_at"]),
                "bound_at": self._iso(now),
            }
            users["users"].append(account)
            self._save_users(users)
            self._save_runtime(runtime)
            return account

    def login(self, *, email: str, password: str) -> WebSession | None:
        try:
            normalized_email = self.normalize_email(email)
        except ValueError:
            return None
        with self._lock:
            user = self._find_user_by_email(self._load_users(), normalized_email)
            if user is None or user.get("status") != "active" or not user.get("feishu"):
                return None
            if not self._verify_password(str(password or ""), user.get("password")):
                return None
            now = self._now()
            runtime = self._load_runtime()
            self._cleanup_runtime(runtime, now)
            token = secrets.token_urlsafe(32)
            csrf_token = secrets.token_urlsafe(32)
            expires_at = now + _SESSION_TTL_SECONDS
            runtime["sessions"].append(
                {
                    "token_hash": self._token_hash(token),
                    "csrf_hash": self._token_hash(csrf_token),
                    "csrf_token": csrf_token,
                    "user_id": user["user_id"],
                    "email": user["email"],
                    "created_at": now,
                    "expires_at": expires_at,
                }
            )
            self._save_runtime(runtime)
            return WebSession(
                token=token,
                user_id=user["user_id"],
                email=user["email"],
                csrf_token=csrf_token,
                expires_at=expires_at,
            )

    def verify_session(self, token: str) -> WebSession | None:
        if not token:
            return None
        with self._lock:
            now = self._now()
            runtime = self._load_runtime()
            self._cleanup_runtime(runtime, now)
            token_hash = self._token_hash(token)
            for session in runtime["sessions"]:
                if hmac.compare_digest(session.get("token_hash", ""), token_hash):
                    user = self._find_user_by_id(self._load_users(), session.get("user_id", ""))
                    if user is None or user.get("status") != "active" or not user.get("feishu"):
                        runtime["sessions"].remove(session)
                        self._save_runtime(runtime)
                        return None
                    self._save_runtime(runtime)
                    return WebSession(
                        token=token,
                        user_id=session["user_id"],
                        email=session["email"],
                        csrf_token=session.get("csrf_token", ""),
                        expires_at=float(session["expires_at"]),
                    )
            self._save_runtime(runtime)
            return None

    def verify_csrf(self, *, token: str, csrf_token: str) -> bool:
        if not token or not csrf_token:
            return False
        with self._lock:
            now = self._now()
            runtime = self._load_runtime()
            self._cleanup_runtime(runtime, now)
            token_hash = self._token_hash(token)
            csrf_hash = self._token_hash(csrf_token)
            valid = any(
                hmac.compare_digest(session.get("token_hash", ""), token_hash)
                and hmac.compare_digest(session.get("csrf_hash", ""), csrf_hash)
                for session in runtime["sessions"]
            )
            self._save_runtime(runtime)
            return valid

    def logout(self, token: str) -> None:
        if not token:
            return
        with self._lock:
            runtime = self._load_runtime()
            token_hash = self._token_hash(token)
            runtime["sessions"] = [
                session
                for session in runtime["sessions"]
                if not hmac.compare_digest(session.get("token_hash", ""), token_hash)
            ]
            self._save_runtime(runtime)

    def feishu_identities(self, user_id: str) -> list[dict[str, str]]:
        """Return every Feishu identity bound to a web account.

        Same shape ``_feishu_record`` persists: the primary identity first,
        then its fallbacks, each ``{"kind": ..., "subject": ...}``. Unknown or
        unbound accounts yield an empty list.
        """
        with self._lock:
            user = self._find_user_by_id(self._load_users(), str(user_id or ""))
        if user is None:
            return []
        feishu = user.get("feishu")
        if not isinstance(feishu, dict):
            return []
        identities: list[dict[str, str]] = []
        for candidate in (feishu, *(feishu.get("fallbacks") or [])):
            if not isinstance(candidate, dict):
                continue
            kind = str(candidate.get("kind") or "").strip()
            subject = str(candidate.get("subject") or "").strip()
            if kind and subject:
                identities.append({"kind": kind, "subject": subject})
        return identities

    def feishu_subject(self, user_id: str, kind: str) -> str | None:
        """Return the bound Feishu subject for ``kind`` (e.g. ``open_id``)."""
        for identity in self.feishu_identities(user_id):
            if identity["kind"] == kind:
                return identity["subject"]
        return None

    def cron_owner_id(self, user_id: str) -> str | None:
        """Return the cron ``origin.user_id`` this web account owns.

        Must match what the Feishu adapter puts on a messaging session:
        ``_resolve_sender_profile`` prefers the tenant-scoped ``user_id`` and
        falls back to the app-scoped ``open_id``. Cron's per-user isolation
        (``tools/cronjob_tools.py`` ``_job_owned_by``) compares that exact
        value, so a different precedence here would split one person's jobs
        into two halves invisible to each other across web and Feishu.
        """
        subjects = {identity["kind"]: identity["subject"] for identity in self.feishu_identities(user_id)}
        return subjects.get("user_id") or subjects.get("open_id")

    def owner_subjects(self, user_id: str) -> set[str]:
        """Every Feishu subject that may appear as a job's ``origin.user_id``."""
        return {identity["subject"] for identity in self.feishu_identities(user_id)}

    def _load_users(self) -> dict[str, Any]:
        if not self._users_path.exists():
            return {"version": 1, "users": []}
        try:
            data = json.loads(self._users_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError("invalid users registry") from exc
        if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("users"), list):
            raise ValueError("invalid users registry")
        return data

    def _load_runtime(self) -> dict[str, list[dict[str, Any]]]:
        if not self._runtime_path.exists():
            return {"pending_registrations": [], "sessions": []}
        try:
            data = json.loads(self._runtime_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError("invalid web auth runtime") from exc
        if not isinstance(data, dict):
            raise ValueError("invalid web auth runtime")
        pending = data.get("pending_registrations")
        sessions = data.get("sessions")
        if not isinstance(pending, list) or not isinstance(sessions, list):
            raise ValueError("invalid web auth runtime")
        return {"pending_registrations": pending, "sessions": sessions}

    def _save_users(self, users: dict[str, Any]) -> None:
        self._secure_json_write(self._users_path, users)

    def _save_runtime(self, runtime: dict[str, Any]) -> None:
        self._secure_json_write(self._runtime_path, runtime)

    @staticmethod
    def _secure_json_write(path: Path, data: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as file:
                json.dump(data, file, ensure_ascii=False, indent=2)
                file.write("\n")
                file.flush()
                os.fsync(file.fileno())
            os.chmod(temporary, 0o600)
            os.replace(temporary, path)
        except BaseException:
            try:
                os.unlink(temporary)
            except OSError:
                pass
            raise

    @staticmethod
    def _encode(value: bytes) -> str:
        return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")

    @staticmethod
    def _decode(value: str) -> bytes:
        return base64.urlsafe_b64decode(str(value) + "=" * (-len(str(value)) % 4))

    @staticmethod
    def _code_hash(code: str, salt: bytes) -> str:
        return hashlib.sha256(salt + code.encode("ascii")).hexdigest()

    @staticmethod
    def _token_hash(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def _password_record(self, password: str, salt: bytes) -> dict[str, Any]:
        digest = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=_SCRYPT_N,
            r=_SCRYPT_R,
            p=_SCRYPT_P,
            dklen=_SCRYPT_DKLEN,
            maxmem=_SCRYPT_MAXMEM,
        )
        return {
            "algorithm": "scrypt",
            "n": _SCRYPT_N,
            "r": _SCRYPT_R,
            "p": _SCRYPT_P,
            "dklen": _SCRYPT_DKLEN,
            "salt": self._encode(salt),
            "digest": self._encode(digest),
        }

    def _verify_password(self, password: str, record: Any) -> bool:
        if not isinstance(record, dict):
            return False
        if (
            record.get("algorithm") != "scrypt"
            or record.get("n") != _SCRYPT_N
            or record.get("r") != _SCRYPT_R
            or record.get("p") != _SCRYPT_P
            or record.get("dklen") != _SCRYPT_DKLEN
        ):
            return False
        try:
            derived = hashlib.scrypt(
                password.encode("utf-8"),
                salt=self._decode(record["salt"]),
                n=_SCRYPT_N,
                r=_SCRYPT_R,
                p=_SCRYPT_P,
                dklen=_SCRYPT_DKLEN,
                maxmem=_SCRYPT_MAXMEM,
            )
            expected = self._decode(record["digest"])
        except (KeyError, TypeError, ValueError, OSError):
            return False
        return hmac.compare_digest(derived, expected)

    @staticmethod
    def _identities(
        *, union_id: str | None, user_id: str | None, open_id: str | None
    ) -> list[dict[str, str]]:
        values = (
            ("union_id", union_id),
            ("user_id", user_id),
            ("open_id", open_id),
        )
        return [
            {"kind": kind, "subject": str(subject).strip()}
            for kind, subject in values
            if str(subject or "").strip()
        ]

    @staticmethod
    def _feishu_record(identities: list[dict[str, str]]) -> dict[str, Any]:
        primary = identities[0]
        return {"kind": primary["kind"], "subject": primary["subject"], "fallbacks": identities[1:]}

    @staticmethod
    def _find_user_by_email(users: dict[str, Any], email: str) -> dict[str, Any] | None:
        for user in users["users"]:
            if isinstance(user, dict) and user.get("email") == email:
                return user
        return None

    @staticmethod
    def _find_user_by_id(users: dict[str, Any], user_id: str) -> dict[str, Any] | None:
        for user in users["users"]:
            if isinstance(user, dict) and user.get("user_id") == user_id:
                return user
        return None

    @staticmethod
    def _find_user_for_identity(
        users: dict[str, Any], identities: list[dict[str, str]]
    ) -> dict[str, Any] | None:
        sought = {(identity["kind"], identity["subject"]) for identity in identities}
        for user in users["users"]:
            if not isinstance(user, dict) or user.get("status") != "active":
                continue
            feishu = user.get("feishu")
            if not isinstance(feishu, dict):
                continue
            candidates = [feishu, *(feishu.get("fallbacks") or [])]
            for candidate in candidates:
                if isinstance(candidate, dict) and (candidate.get("kind"), candidate.get("subject")) in sought:
                    return user
        return None

    def _new_code(self, runtime: dict[str, Any]) -> str:
        while True:
            code = "".join(secrets.choice(_BINDING_CODE_ALPHABET) for _ in range(_BINDING_CODE_LENGTH))
            if all(not self._matches_code(code, entry) for entry in runtime["pending_registrations"]):
                return code

    def _take_pending(self, runtime: dict[str, Any], code: str) -> dict[str, Any] | None:
        normalized = str(code or "").strip().upper()
        for index, entry in enumerate(runtime["pending_registrations"]):
            if self._matches_code(normalized, entry):
                return runtime["pending_registrations"].pop(index)
        return None

    def _matches_code(self, code: str, entry: dict[str, Any]) -> bool:
        try:
            expected = entry["code_hash"]
            actual = self._code_hash(code, self._decode(entry["code_salt"]))
        except (KeyError, TypeError, ValueError):
            return False
        return hmac.compare_digest(actual, expected)

    @staticmethod
    def _cleanup_runtime(runtime: dict[str, Any], now: float) -> None:
        runtime["pending_registrations"] = [
            entry
            for entry in runtime["pending_registrations"]
            if isinstance(entry, dict) and float(entry.get("expires_at", 0)) > now
        ]
        runtime["sessions"] = [
            entry
            for entry in runtime["sessions"]
            if isinstance(entry, dict) and float(entry.get("expires_at", 0)) > now
        ]

    @staticmethod
    def _iso(timestamp: float) -> str:
        return datetime.fromtimestamp(timestamp, UTC).isoformat().replace("+00:00", "Z")
