import json
from pathlib import Path

import pytest

from quantum_time_travel.spec import AggregationPolicy, aggregate_cost, load_spec
from quantum_time_travel.planner import plan_cycle_ABC


def test_aggregate_cost_negative_edges_allowed():
    pol = AggregationPolicy(allow_negative_edges=True)
    # credits exceed combined penalties -> negative cost edge
    c = aggregate_cost({"energy_j": 1e9, "duration_s": 10, "risk_prob": 0.0, "credits": 100.0}, pol)
    assert c < 0


def test_load_spec_and_plan(tmp_path: Path):
    spec = {
        "states": ["A", "B", "C"],
        "initial": "A",
        "ABC": ["A", "B", "C"],
    "policy": {"allow_negative_edges": True},
        "transitions": [
            {"src": "A", "dst": "B", "attributes": {"energy_j": 1e9, "duration_s": 1, "risk_prob": 0.0}},
            {"src": "B", "dst": "C", "attributes": {"energy_j": 1e9, "duration_s": 1, "risk_prob": 0.0}},
            {"src": "C", "dst": "A", "attributes": {"energy_j": 1e9, "duration_s": 1, "risk_prob": 0.0}}
        ]
    }
    p = tmp_path / "s.json"
    p.write_text(json.dumps(spec))
    fsm, A, B, C, pol = load_spec(str(p))
    res = plan_cycle_ABC(fsm, A, B, C, forbid_negative_edges=not pol.allow_negative_edges)
    assert res.ok


def test_invariant_velocity_bounds():
    pol = AggregationPolicy(strict_invariants=True)
    with pytest.raises(ValueError):
        aggregate_cost({"velocity_fraction_c": 1.2}, pol)
