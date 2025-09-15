from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Hashable, Iterable, Optional, Tuple


State = Hashable
Event = Hashable


@dataclass(frozen=True)
class Transition:
    src: State
    event: Optional[Event]
    dst: State
    weight: float = 0.0  # cost or potential; negative allowed but guarded in planner


class FSM:
    """Minimal deterministic FSM with weighted transitions.

    - States: hashable labels (e.g., "A", "B", "C")
    - Events: optional labels; None means epsilon transition
    - Transitions: (src, event)->(dst) with weight (cost). Multiple transitions per (src,event)
      are allowed, making it a general graph labeled by events.
    """

    def __init__(self, states: Iterable[State], initial: State):
        self.states = set(states)
        if initial not in self.states:
            raise ValueError("initial state not in states")
        self.initial = initial
        self._edges: Dict[Tuple[State, Optional[Event]], Dict[State, float]] = {}

    def add_transition(self, src: State, dst: State, event: Optional[Event] = None, weight: float = 0.0) -> None:
        if src not in self.states or dst not in self.states:
            raise ValueError("src/dst must be existing states")
        key = (src, event)
        bucket = self._edges.setdefault(key, {})
        bucket[dst] = float(weight)

    def neighbors(self, src: State, event: Optional[Event] = None) -> Dict[State, float]:
        return dict(self._edges.get((src, event), {}))

    def transitions(self) -> Iterable[Transition]:
        for (src, event), dsts in self._edges.items():
            for dst, w in dsts.items():
                yield Transition(src, event, dst, w)
