from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from .fsm import FSM


C_M_PER_S = 299_792_458.0


@dataclass
class AggregationPolicy:
    energy_weight: float = 1.0
    earth_time_weight: float = 0.1
    crew_time_weight: float = 0.2
    risk_weight: float = 2.0
    allow_negative_edges: bool = True
    strict_invariants: bool = True
    energy_scale: float = 1e9  # normalize Joules to giga scale by default
    infer_velocity_from_distance_and_duration: bool = True
    mode: str | None = None  # e.g., "real_world"


def _gamma(beta: float) -> float:
    if beta < 0 or beta >= 1:
        raise ValueError("velocity_fraction_c must be in [0,1)")
    return 1.0 / math.sqrt(1.0 - beta * beta)


def aggregate_cost_with_breakdown(attrs: Dict[str, Any], policy: AggregationPolicy) -> Tuple[float, Dict[str, Any]]:
    """Fuse multi-attributes to a scalar cost and return breakdown and computed values.

    Attributes (optional unless noted):
    - energy_j (>=0)
    - distance_m (>=0)
    - velocity_fraction_c in [0,1)
    - mass_kg (>=0)
    - risk_prob in [0,1)
    - duration_s (>=0) Earth frame duration (derived from timestamps if missing)
    - earth_departure_epoch_s, earth_arrival_epoch_s (derive duration if present)
    - crew_time_s (>=0) Proper time for travelers
    - credits (can be negative or positive)
    """
    energy_j = float(attrs.get("energy_j", 0.0))
    distance_m = float(attrs.get("distance_m", 0.0))
    beta = attrs.get("velocity_fraction_c")
    mass_kg = float(attrs.get("mass_kg", 0.0))
    risk_prob = float(attrs.get("risk_prob", 0.0))
    # Allow deriving duration from timestamps if not provided
    if "duration_s" in attrs:
        duration_s = float(attrs.get("duration_s", 0.0))
    else:
        dep = attrs.get("earth_departure_epoch_s")
        arr = attrs.get("earth_arrival_epoch_s")
        if dep is not None and arr is not None:
            try:
                duration_s = max(0.0, float(arr) - float(dep))
            except Exception:
                duration_s = 0.0
        else:
            duration_s = 0.0
    crew_time_s = attrs.get("crew_time_s")
    credits = float(attrs.get("credits", 0.0))

    # Invariants
    if policy.strict_invariants:
        if energy_j < 0 or distance_m < 0 or mass_kg < 0 or duration_s < 0:
            raise ValueError("energy_j, distance_m, mass_kg, duration_s must be >= 0")
        if not (0.0 <= risk_prob < 1.0):
            raise ValueError("risk_prob must be in [0,1)")
        # beta may be None if we infer it below

        # Optional kinematic lower bound: T >= D / v, only if beta provided and > 0
        if distance_m > 0 and duration_s > 0 and (beta is not None) and (beta > 0):
            v = float(beta) * C_M_PER_S
            if v > 0:
                min_time = distance_m / v
                if duration_s + 1e-9 < min_time:
                    raise ValueError("duration_s violates kinematic lower bound distance/velocity")

    # Time terms
    # Infer beta if requested and possible
    if (beta is None) and policy.infer_velocity_from_distance_and_duration and distance_m > 0 and duration_s > 0:
        v = distance_m / duration_s
        beta = max(0.0, min(v / C_M_PER_S, 0.999999))
    beta = float(beta or 0.0)

    if policy.strict_invariants:
        if not (0.0 <= beta < 1.0):
            raise ValueError("velocity_fraction_c must be in [0,1)")

    if beta > 0:
        g = _gamma(beta)
    else:
        g = 1.0
    # If crew_time_s not given, derive approximate proper time from dilation
    if crew_time_s is None:
        crew_time_s = duration_s / g if duration_s > 0 else 0.0
    else:
        crew_time_s = float(crew_time_s)

    # Risk transformed to convex penalty: -log(1-p) ~ p for small p
    risk_penalty = -math.log(max(1e-12, 1.0 - min(max(risk_prob, 0.0), 0.999999)))

    # Normalize energy to a manageable scale
    # Dynamic effective weights (real_world mode)
    e_w = policy.energy_weight
    et_w = policy.earth_time_weight
    ct_w = policy.crew_time_weight
    r_w = policy.risk_weight
    if (policy.mode or "").lower() == "real_world":
        # Increase time weights for longer trips; increase risk weight with risk prob
        days = duration_s / 86400.0 if duration_s > 0 else 0.0
        et_w *= (1.0 + min(days, 10.0) * 0.05)  # up to +50%
        ct_w *= (1.0 + min(days, 10.0) * 0.02)  # up to +20%
        r_w *= (1.0 + min(max(risk_prob, 0.0), 0.99) * 2.0)  # up to ~3x

    energy_term = energy_j / max(1.0, policy.energy_scale)
    time_term = et_w * duration_s + ct_w * crew_time_s
    risk_term = r_w * risk_penalty

    cost = policy.energy_weight * energy_term + time_term + risk_term - credits

    # Allow negative edges if configured; otherwise clamp to zero floor
    if not policy.allow_negative_edges:
        cost = max(0.0, cost)
    # Kinematic and plausibility warnings
    warnings: List[str] = []
    if distance_m > 0 and duration_s > 0 and beta > 0:
        v = beta * C_M_PER_S
        min_time = distance_m / v
        if duration_s + 1e-9 < min_time:
            warnings.append("duration below kinematic bound distance/velocity")
    if beta >= 0.9:
        warnings.append("high relativistic speed (beta>=0.9)")
    if distance_m > 0 and duration_s > 0 and (distance_m / duration_s) > C_M_PER_S:
        warnings.append("implied superluminal average speed from distance/duration")
    if risk_prob >= 0.2:
        warnings.append("high mission risk (risk_prob>=0.2)")
    if crew_time_s > duration_s + 1e-9:
        warnings.append("crew_time exceeds earth-frame duration (unexpected)")

    breakdown = {
        "energy_j": energy_j,
        "distance_m": distance_m,
        "velocity_fraction_c": beta,
        "gamma": g,
        "duration_s": duration_s,
        "crew_time_s": crew_time_s,
        "risk_prob": risk_prob,
        "risk_penalty": risk_penalty,
        "credits": credits,
        "effective_weights": {"energy": e_w, "earth_time": et_w, "crew_time": ct_w, "risk": r_w},
        "terms": {
            "energy_term": energy_term,
            "time_term": time_term,
            "risk_term": risk_term
        },
        "warnings": warnings
    }
    return float(cost), breakdown


def aggregate_cost(attrs: Dict[str, Any], policy: AggregationPolicy) -> float:
    cost, _ = aggregate_cost_with_breakdown(attrs, policy)
    return cost


def load_spec(path: str) -> Tuple[FSM, str, str, str, AggregationPolicy]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    states = data.get("states")
    initial = data.get("initial")
    transitions = data.get("transitions", [])
    abc = data.get("ABC", ["A", "B", "C"])  # default
    if not isinstance(states, list) or not states:
        raise ValueError("states must be a non-empty list")
    if initial not in states:
        raise ValueError("initial must be in states")
    if not (isinstance(abc, list) and len(abc) == 3 and all(a in states for a in abc)):
        raise ValueError("ABC must be a 3-item list of states present in 'states'")

    policy_data = data.get("policy", {})
    policy = AggregationPolicy(
        energy_weight=float(policy_data.get("weights", {}).get("energy", 1.0)),
        earth_time_weight=float(policy_data.get("weights", {}).get("earth_time", 0.1)),
        crew_time_weight=float(policy_data.get("weights", {}).get("crew_time", 0.2)),
        risk_weight=float(policy_data.get("weights", {}).get("risk", 2.0)),
        allow_negative_edges=bool(policy_data.get("allow_negative_edges", True)),
        strict_invariants=bool(policy_data.get("strict_invariants", True)),
        energy_scale=float(policy_data.get("energy_scale", 1e9)),
        mode=str(policy_data.get("mode")) if policy_data.get("mode") is not None else None,
    )

    fsm = FSM(states, initial=initial)
    for t in transitions:
        src = t.get("src")
        dst = t.get("dst")
        attrs = t.get("attributes", {})
        if src not in fsm.states or dst not in fsm.states:
            raise ValueError("transition src/dst must be in states")
        w = aggregate_cost(attrs, policy)
        fsm.add_transition(src, dst, weight=w)

    A, B, C = abc
    return fsm, A, B, C, policy
