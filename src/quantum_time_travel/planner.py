from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Optional, Tuple

from .fsm import FSM, State
from .graph import Edge, bellman_ford, detect_any_negative_cycle


@dataclass
class PlanResult:
    path: List[State]
    cost: float
    ok: bool
    reason: str = ""


def _edges_from_fsm(fsm: FSM) -> List[Edge]:
    return [Edge(t.src, t.dst, t.weight) for t in fsm.transitions()]


def _shortest_path(nodes: Iterable[State], edges: List[Edge], src: State, dst: State) -> Tuple[List[State], float, str]:
    """Compute shortest path using Bellman-Ford (handles negative edges, no negative cycles)."""
    dist, pred, has_neg_cycle = bellman_ford(nodes, edges, src)
    if has_neg_cycle:
        return [], float("inf"), "negative cycle detected"

    if dist.get(dst, float("inf")) == float("inf"):
        return [], float("inf"), "unreachable"

    # reconstruct
    path: List[State] = []
    cur: Optional[State] = dst
    visited = set()
    while cur is not None:
        if cur in visited:
            return [], float("inf"), "path reconstruction cycle detected"
        visited.add(cur)
        path.append(cur)
        cur = pred.get(cur)
    path.reverse()
    if path and path[0] != src:
        return [], float("inf"), "path reconstruction failed"
    return path, dist[dst], ""


def plan_cycle_ABC(fsm: FSM, A: State, B: State, C: State, forbid_negative_edges: bool = False) -> PlanResult:
    """Plan A->B->C->A with safety:
    - Optional: forbid transitions with negative weights entirely
    - Always: detect and fail on negative cycles
    - Use Bellman-Ford to allow negative edges when safe
    """
    if A not in fsm.states or B not in fsm.states or C not in fsm.states:
        return PlanResult([], float("inf"), False, "A/B/C not in FSM states")

    edges = _edges_from_fsm(fsm)
    nodes = list(fsm.states)

    if forbid_negative_edges:
        edges = [e for e in edges if e.w >= 0]

    if detect_any_negative_cycle(nodes, edges):
        return PlanResult([], float("inf"), False, "negative cycle exists in graph")

    p1, c1, r1 = _shortest_path(nodes, edges, A, B)
    if not p1:
        return PlanResult([], float("inf"), False, f"A->B planning failed: {r1}")
    p2, c2, r2 = _shortest_path(nodes, edges, B, C)
    if not p2:
        return PlanResult([], float("inf"), False, f"B->C planning failed: {r2}")
    p3, c3, r3 = _shortest_path(nodes, edges, C, A)
    if not p3:
        return PlanResult([], float("inf"), False, f"C->A planning failed: {r3}")

    # Concatenate paths while avoiding duplicated nodes at boundaries
    path = p1 + p2[1:] + p3[1:]
    total_cost = c1 + c2 + c3
    return PlanResult(path, total_cost, True, "ok")
