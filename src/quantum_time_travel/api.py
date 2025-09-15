from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
import os
import platform
import uuid
from pydantic import BaseModel

from .planner import plan_cycle_ABC
from .spec import load_spec, aggregate_cost, AggregationPolicy, aggregate_cost_with_breakdown
from .logger import log_event


APP_VERSION = "0.1.0"
RUN_ID = os.environ.get("QTT_RUN_ID", str(uuid.uuid4()))
app = FastAPI(title="Quantum Time Travel API", version=APP_VERSION)

# Simple in-memory cache of the last submitted spec and results for convenience in the UI
LAST_SPEC: Dict[str, Any] | None = None
LAST_PLAN: Dict[str, Any] | None = None
LAST_VALIDATE: Dict[str, Any] | None = None


class PlanResponse(BaseModel):
    ok: bool
    reason: str
    path: list[str]
    cost: float | None


@app.post("/api/plan", response_model=PlanResponse)
def api_plan(payload: Dict[str, Any]):  # payload is a JSON spec
    try:
        # Write to a temp file-like pathless load: reuse existing loader
        spec_path = Path("/tmp/_spec.json")
        spec_path.write_text(json.dumps(payload))
        fsm, A, B, C, pol = load_spec(str(spec_path))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    res = plan_cycle_ABC(fsm, A, B, C, forbid_negative_edges=not pol.allow_negative_edges)
    log_event("api_plan", ok=res.ok, path=res.path, cost=res.cost, reason=res.reason)
    safe_cost: float | None = res.cost if (res.ok and not (res.cost == float("inf") or res.cost == float("-inf") or res.cost != res.cost)) else None
    # Cache last plan and spec (truncated for safety)
    global LAST_SPEC, LAST_PLAN
    try:
        LAST_SPEC = payload
    except Exception:
        LAST_SPEC = None
    LAST_PLAN = {"ok": res.ok, "reason": res.reason, "path": res.path, "cost": safe_cost}
    return PlanResponse(ok=res.ok, reason=res.reason, path=res.path, cost=safe_cost)


@app.post("/api/spec/validate")
def api_spec_validate(payload: Dict[str, Any]):
    try:
        policy_data = payload.get("policy", {})
        policy = AggregationPolicy(
            energy_weight=float(policy_data.get("weights", {}).get("energy", 1.0)),
            earth_time_weight=float(policy_data.get("weights", {}).get("earth_time", 0.1)),
            crew_time_weight=float(policy_data.get("weights", {}).get("crew_time", 0.2)),
            risk_weight=float(policy_data.get("weights", {}).get("risk", 2.0)),
            allow_negative_edges=bool(policy_data.get("allow_negative_edges", True)),
            strict_invariants=bool(policy_data.get("strict_invariants", True)),
            energy_scale=float(policy_data.get("energy_scale", 1e9)),
            infer_velocity_from_distance_and_duration=bool(policy_data.get("infer_velocity", True)),
        )
        warned_only = bool(payload.get("warned_only", False))
        edges = []
        for t in payload.get("transitions", []):
            w, br = aggregate_cost_with_breakdown(t.get("attributes", {}), policy)
            warn_count = len(br.get("warnings", []) or [])
            if warned_only and warn_count == 0:
                continue
            edges.append({"src": t.get("src"), "dst": t.get("dst"), "weight": w, "breakdown": br, "warning_count": warn_count})
        total_warnings = sum(e.get("warning_count", 0) for e in edges)
        edges_with_warnings = sum(1 for e in edges if (e.get("warning_count", 0) > 0))
        result = {
            "edges": edges,
            "policy": {"allow_negative_edges": policy.allow_negative_edges},
            "summary": {"total_warnings": int(total_warnings), "edges_with_warnings": int(edges_with_warnings), "edge_count": len(edges)},
        }
        log_event("api_spec_validate", edges=len(edges), total_warnings=total_warnings)
        # Cache last validation and spec
        global LAST_SPEC, LAST_VALIDATE
        try:
            LAST_SPEC = payload
        except Exception:
            LAST_SPEC = None
        LAST_VALIDATE = result
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.middleware("http")
async def log_requests(request: Request, call_next):
    req_id = str(uuid.uuid4())
    try:
        body = await request.body()
    except Exception:
        body = b""
    log_event("http_request", method=request.method, path=request.url.path, body_len=len(body), request_id=req_id, run_id=RUN_ID)
    response = await call_next(request)
    if hasattr(response, "headers"):
        response.headers["X-Request-Id"] = req_id
        response.headers["X-Run-Id"] = RUN_ID
    log_event("http_response", path=request.url.path, status=response.status_code, request_id=req_id, run_id=RUN_ID)
    return response


@app.get("/api/repo/list")
def api_repo_list():
    root = Path(".")
    files = []
    for p in root.rglob("*"):
        if p.is_file() and ".git" not in p.parts and ".venv" not in p.parts:
            files.append(str(p))
    return {"files": files}


@app.get("/api/repo/file")
def api_repo_file(path: str):
    p = Path(path)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    if ".." in Path(path).parts:
        raise HTTPException(status_code=400, detail="invalid path")
    # limit size
    content = p.read_text(encoding="utf-8", errors="ignore")[:200000]
    return {"path": path, "content": content}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/status")
def status():
    info: Dict[str, Any] = {
        "status": "ok",
        "version": APP_VERSION,
        "run_id": RUN_ID,
        "python": platform.python_version(),
    }
    if LAST_PLAN is not None:
        info["last_plan"] = LAST_PLAN
    if LAST_VALIDATE is not None:
        # Only include a shallow summary to keep response small
        try:
            summ = LAST_VALIDATE.get("summary", {}) if isinstance(LAST_VALIDATE, dict) else {}
        except Exception:
            summ = {}
        info["last_validate"] = summ
    return info


@app.get("/api/logs/tail")
def logs_tail(limit: int = 200):
    """Return the last N lines from the structured events log.
    Intended for quick status diagnostics in the UI.
    """
    try:
        limit = max(1, min(int(limit), 1000))
    except Exception:
        limit = 200
    log_dir = os.environ.get("QTT_LOG_DIR", ".logs")
    path = Path(log_dir) / "events.log"
    if not path.exists():
        return {"lines": []}
    lines: list[str] = []
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            block = 4096
            data = b""
            while len(lines) <= limit and size > 0:
                read_size = block if size >= block else size
                size -= read_size
                f.seek(size)
                data = f.read(read_size) + data
                lines = data.splitlines()[-limit:]
        decoded = [ln.decode("utf-8", errors="ignore") for ln in lines]
        return {"lines": decoded}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/logs/download")
def logs_download():
    """Download the structured events log file if it exists."""
    log_dir = os.environ.get("QTT_LOG_DIR", ".logs")
    path = Path(log_dir) / "events.log"
    if not path.exists():
        raise HTTPException(status_code=404, detail="no log file")
    return FileResponse(path, media_type="text/plain", filename="events.log")


@app.get("/api/spec/last")
def spec_last():
    """Return the last submitted spec payload with minimal metadata."""
    if LAST_SPEC is None:
        return {"spec": None}
    try:
        # Avoid returning extremely large payloads: cap to ~1MB when serialized
        text = json.dumps(LAST_SPEC)
        if len(text) > 1_000_000:
            return {"spec": None, "note": "last spec too large to return"}
        return {"spec": LAST_SPEC}
    except Exception:
        return {"spec": None}
