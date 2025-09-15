from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Hashable, Iterable, List, Optional, Tuple


Node = Hashable


@dataclass
class Edge:
    u: Node
    v: Node
    w: float


def bellman_ford(nodes: Iterable[Node], edges: Iterable[Edge], source: Node) -> Tuple[Dict[Node, float], Dict[Node, Optional[Node]], bool]:
    """Bellman-Ford shortest paths with predecessor tracking and negative cycle detection.

    Returns (distance, predecessor, has_negative_cycle_reachable_from_source)
    """
    nodes_list: List[Node] = list(nodes)
    dist: Dict[Node, float] = {n: float("inf") for n in nodes_list}
    pred: Dict[Node, Optional[Node]] = {n: None for n in nodes_list}
    dist[source] = 0.0
    edges_list = list(edges)

    for _ in range(len(nodes_list) - 1):
        changed = False
        for e in edges_list:
            if dist[e.u] + e.w < dist[e.v]:
                dist[e.v] = dist[e.u] + e.w
                pred[e.v] = e.u
                changed = True
        if not changed:
            break

    for e in edges_list:
        if dist[e.u] + e.w < dist[e.v]:
            return dist, pred, True
    return dist, pred, False


def detect_any_negative_cycle(nodes: Iterable[Node], edges: Iterable[Edge]) -> bool:
    # Super-source technique: connect a new source to all nodes with zero-weight edge
    nodes_list = list(nodes)
    super_source = object()
    dist: Dict[Node, float] = {n: 0.0 for n in nodes_list}
    edges_list = list(edges) + [Edge(super_source, n, 0.0) for n in nodes_list]

    # Relax |V|-1 times
    for _ in range(len(nodes_list) - 1):
        for e in edges_list:
            if dist.get(e.u, float("inf")) + e.w < dist.get(e.v, float("inf")):
                dist[e.v] = dist.get(e.u, float("inf")) + e.w

    # Check for negative cycles
    for e in edges_list:
        if dist.get(e.u, float("inf")) + e.w < dist.get(e.v, float("inf")):
            return True
    return False
