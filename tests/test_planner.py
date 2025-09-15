from quantum_time_travel.fsm import FSM
from quantum_time_travel.planner import plan_cycle_ABC


def test_plan_simple_cycle():
    fsm = FSM(["A", "B", "C"], initial="A")
    fsm.add_transition("A", "B", weight=1)
    fsm.add_transition("B", "C", weight=2)
    fsm.add_transition("C", "A", weight=3)
    res = plan_cycle_ABC(fsm, "A", "B", "C")
    assert res.ok
    assert res.path[0] == "A" and res.path[-1] == "A"
    assert res.cost == 6


def test_negative_edge_but_no_cycle():
    fsm = FSM(["A", "B", "C"], initial="A")
    fsm.add_transition("A", "B", weight=-1)
    fsm.add_transition("B", "C", weight=2)
    fsm.add_transition("C", "A", weight=3)
    res = plan_cycle_ABC(fsm, "A", "B", "C")
    assert res.ok
    assert res.cost == 4


def test_negative_cycle_rejected():
    fsm = FSM(["A", "B", "C"], initial="A")
    fsm.add_transition("A", "B", weight=1)
    fsm.add_transition("B", "A", weight=-3)  # negative cycle A<->B net -2
    fsm.add_transition("B", "C", weight=1)
    fsm.add_transition("C", "A", weight=1)
    res = plan_cycle_ABC(fsm, "A", "B", "C")
    assert not res.ok
    assert "negative cycle" in res.reason
