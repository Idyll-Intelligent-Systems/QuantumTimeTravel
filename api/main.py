from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import math
import os

app = FastAPI(title="Quantum Time Travel API", version="0.1.0")

class Transition(BaseModel):
    src: str
    dst: str
    attributes: Dict[str, Any] = {}

class Policy(BaseModel):
    mode: Optional[str] = None
    allow_negative_edges: Optional[bool] = True
    strict_invariants: Optional[bool] = True
    weights: Optional[Dict[str, float]] = None
    energy_scale: Optional[float] = None

class Spec(BaseModel):
    states: List[str]
    initial: str
    ABC: Optional[List[str]] = None
    policy: Optional[Policy] = None
    transitions: List[Transition]
    warned_only: Optional[bool] = Field(default=False, description="If true, only return edges with warnings in validation")

@app.get("/health")
async def health():
    return {"ok": True}

@app.get("/api/status")
async def status():
    return {"version": app.version, "run_id": os.getenv("HOSTNAME", "dev")}

@app.post("/api/plan")
async def plan(spec: Spec):
    # Minimal mock: return a trivial path if ABC provided
    path = spec.ABC or []
    return {"ok": True, "reason": "mock", "path": path, "cost": None}

@app.post("/api/spec/validate")
async def validate(spec: Spec):
    edges = []
    c = 299_792_458.0
    warned_only = spec.warned_only or False
    for t in spec.transitions:
        a = t.attributes or {}
        d = a.get("distance_m")
        dur = a.get("duration_s")
        dep = a.get("earth_departure_epoch_s")
        arr = a.get("earth_arrival_epoch_s")
        if d is None and dep and arr:
            # cannot derive distance; keep minimal
            pass
        duration = dur if dur else (arr - dep if (dep and arr and arr > dep) else None)
        warnings: List[str] = []
        beta = 0.0
        gamma = 1.0
        crew_time = duration or 0.0
        if d and duration and duration > 0:
            v = d / duration
            beta = v / c
            if v > c:
                warnings.append("implied superluminal average speed")
                beta = min(beta, 0.999999)
            if beta >= 0.9:
                warnings.append("high relativistic speed (beta≥0.9)")
            gamma = 1.0 / math.sqrt(1 - min(beta, 0.999999) ** 2)
            crew_time = (duration / gamma)
        risk = a.get("risk_prob", 0.0)
        if risk >= 0.2:
            warnings.append("high mission risk (risk_prob≥0.2)")
        weight = 0.0
        edges.append({
            "src": t.src,
            "dst": t.dst,
            "weight": weight,
            "breakdown": {
                "velocity_fraction_c": beta,
                "gamma": gamma,
                "duration_s": duration or 0.0,
                "crew_time_s": crew_time,
                "risk_prob": risk,
                "warnings": warnings,
                "terms": {"energy_term": 0, "time_term": 0, "risk_term": -math.log(max(1e-9, 1.0 - risk)) if risk > 0 else 0}
            }
        })
    if warned_only:
        edges = [e for e in edges if e["breakdown"].get("warnings")]
    return {"edges": edges}
