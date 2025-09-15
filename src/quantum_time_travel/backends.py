from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Protocol


class QuantumBackend(Protocol):
    """Minimal protocol for quantum backends we may target.

    Implementations should be side-effect-safe and avoid leaking secrets.
    """

    name: str

    def transpile(self, circuit: Any, **kwargs: Any) -> Any:
        ...

    def run(self, circuit: Any, shots: int = 1024, **kwargs: Any) -> Dict[str, Any]:
        ...


@dataclass
class NullBackend:
    """No-op backend useful for tests and offline simulation."""

    name: str = "null-backend"

    def transpile(self, circuit: Any, **kwargs: Any) -> Any:  # pragma: no cover - trivial
        return circuit

    def run(self, circuit: Any, shots: int = 1024, **kwargs: Any) -> Dict[str, Any]:  # pragma: no cover - trivial
        return {"backend": self.name, "shots": shots, "result": "noop"}


def load_backend(kind: str) -> QuantumBackend:
    kind = kind.lower()
    if kind in ("null", "noop"):
        return NullBackend()

    if kind == "qiskit":  # lazy import to avoid hard deps
        try:
            from qiskit import transpile as q_transpile
            from qiskit_aer import Aer

            class QiskitBackend:
                name = "qiskit-aer-simulator"

                def transpile(self, circuit: Any, **kwargs: Any) -> Any:
                    backend = Aer.get_backend("aer_simulator")
                    return q_transpile(circuit, backend=backend, **kwargs)

                def run(self, circuit: Any, shots: int = 1024, **kwargs: Any) -> Dict[str, Any]:
                    backend = Aer.get_backend("aer_simulator")
                    job = backend.run(circuit, shots=shots, **kwargs)
                    return {"counts": job.result().get_counts(), "backend": self.name}

            return QiskitBackend()
        except Exception as e:  # pragma: no cover - optional path
            raise RuntimeError("Qiskit backend requested but not available") from e

    if kind == "cirq":
        try:
            import cirq

            class CirqBackend:
                name = "cirq-simulator"

                def transpile(self, circuit: Any, **kwargs: Any) -> Any:
                    return circuit

                def run(self, circuit: Any, shots: int = 1024, **kwargs: Any) -> Dict[str, Any]:
                    simulator = cirq.Simulator()
                    result = simulator.run(circuit, repetitions=shots)
                    return {"result": str(result), "backend": self.name}

            return CirqBackend()
        except Exception as e:  # pragma: no cover
            raise RuntimeError("Cirq backend requested but not available") from e

    if kind == "braket":
        try:
            from braket.devices import LocalSimulator

            class BraketBackend:
                name = "braket-local-simulator"

                def transpile(self, circuit: Any, **kwargs: Any) -> Any:
                    return circuit

                def run(self, circuit: Any, shots: int = 1024, **kwargs: Any) -> Dict[str, Any]:
                    device = LocalSimulator()
                    task = device.run(circuit, shots=shots)
                    return {"result": task.result().measurement_counts, "backend": self.name}

            return BraketBackend()
        except Exception as e:  # pragma: no cover
            raise RuntimeError("Braket backend requested but not available") from e

    raise ValueError(f"Unknown backend kind: {kind}")
