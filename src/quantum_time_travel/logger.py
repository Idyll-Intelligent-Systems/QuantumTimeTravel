from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from typing import Any


REDACT_KEYS = {"token", "auth", "authorization", "password", "secret", "api_key"}


def _redact(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: ("<redacted>" if k.lower() in REDACT_KEYS else _redact(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_redact(v) for v in obj]
    return obj


_LOG_DIR = os.environ.get("QTT_LOG_DIR", ".logs")
_MAX_BYTES = int(os.environ.get("QTT_LOG_MAX_BYTES", "1048576"))  # 1MB
_BACKUPS = int(os.environ.get("QTT_LOG_BACKUPS", "5"))


def _write_file_line(line: str) -> None:
    try:
        os.makedirs(_LOG_DIR, exist_ok=True)
        path = os.path.join(_LOG_DIR, "events.log")
        # naive rotation
        if os.path.exists(path) and os.path.getsize(path) > _MAX_BYTES:
            for i in range(_BACKUPS, 0, -1):
                older = f"{path}.{i}"
                newer = f"{path}.{i-1}" if i > 1 else path
                if os.path.exists(older):
                    try: os.remove(older)
                    except Exception: pass
                if os.path.exists(newer):
                    try: os.rename(newer, older)
                    except Exception: pass
        with open(path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        # ignore file logging errors
        pass


def log_event(event: str, **fields: Any) -> None:
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "event": event,
        **_redact(fields),
    }
    line = json.dumps(record, ensure_ascii=False)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()
    _write_file_line(line)
