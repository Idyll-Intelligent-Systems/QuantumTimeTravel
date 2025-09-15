from __future__ import annotations

import argparse
import json
import sys
from typing import List

from .fsm import FSM
from .planner import plan_cycle_ABC
from .spec import load_spec
from .logger import log_event


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="quantum-time-travel", description="FSM-based planner for A->B->C->A")
    sub = p.add_subparsers(dest="cmd", required=True)

    plan = sub.add_parser("plan", help="Plan A->B->C->A cycle from a simple spec or JSON file")
    plan.add_argument("--states", nargs="+", required=True, help="List of states, e.g., A B C")
    plan.add_argument("--initial", required=True, help="Initial state label")
    plan.add_argument("--edges", nargs="+", required=True, help="Edges of form src:dst:weight, e.g., A:B:1 B:C:2 C:A:3")
    plan.add_argument("--abc", nargs=3, required=True, help="Labels A B C")
    plan.add_argument("--forbid-negative-edges", action="store_true", help="Disallow negative edges entirely")

    spec = sub.add_parser("plan-from-json", help="Plan using a JSON spec file")
    spec.add_argument("path", help="Path to JSON spec")

    return p


def parse_edges(edge_specs: List[str]):
    edges = []
    for spec in edge_specs:
        try:
            src, dst, w = spec.split(":")
            edges.append((src, dst, float(w)))
        except Exception:
            raise SystemExit(f"Invalid edge spec '{spec}'. Expected src:dst:weight")
    return edges


def cmd_plan(args: argparse.Namespace) -> int:
    fsm = FSM(args.states, initial=args.initial)
    for src, dst, w in parse_edges(args.edges):
        fsm.add_transition(src, dst, weight=w)

    A, B, C = args.abc
    res = plan_cycle_ABC(fsm, A, B, C, forbid_negative_edges=args.forbid_negative_edges)
    log_event("plan", ok=res.ok, reason=res.reason, path=res.path, cost=res.cost)
    return 0 if res.ok else 2


def cmd_plan_from_json(args: argparse.Namespace) -> int:
    try:
        fsm, A, B, C, policy = load_spec(args.path)
    except Exception as exc:
        log_event("error", action="load_spec", error=str(exc))
        return 2
    res = plan_cycle_ABC(fsm, A, B, C, forbid_negative_edges=not policy.allow_negative_edges)
    log_event("plan", ok=res.ok, reason=res.reason, path=res.path, cost=res.cost, A=A, B=B, C=C,
              policy={"allow_negative_edges": policy.allow_negative_edges, "strict_invariants": policy.strict_invariants})
    return 0 if res.ok else 2


def main(argv: List[str] | None = None) -> int:
    p = build_arg_parser()
    args = p.parse_args(argv)
    if args.cmd == "plan":
        return cmd_plan(args)
    if args.cmd == "plan-from-json":
        return cmd_plan_from_json(args)
    return 0

if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
