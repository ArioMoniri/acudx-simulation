"""Compressed encounter clock (docs/architecture/14-results-and-imaging-engine.md section 10).

Results keep their clinical turnaround on the SIM clock (stat chemistry about 50 min, CT about
4 h, cultures 1 to 5 days), and every time the learner sees is sim time. Two settings make the
wait short in real time:

* ``scale``: sim ms per real ms. The encounter clock runs this much faster than the wall
  clock (default 6: one real minute is six sim minutes, so a ten-minute session covers the
  first hour of care).
* ``wait_cap_s``: the longest real wait, per turnaround class, before a pending report is
  due. When the cap is reached first, the sim clock jumps to the report (the same step as
  the learner's "Advance to next result" button) and the Clinical Director advances the
  patient by the same sim time. A report after a preliminary one (CT final, culture final)
  waits at most one more cap.

The browser applies the same rule (``web/src/domain/simClock.ts``); both read
``server/tests/fixtures/sim_clock_parity.json`` in their tests. Faculty set the values per
course (the faculty's org) with ``PUT /v1/faculty/sim-clock``.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

WaitClass = Literal["poc", "lab", "imaging", "culture"]
WAIT_CLASSES: tuple[str, ...] = ("poc", "lab", "imaging", "culture")

SCALE_MIN, SCALE_MAX = 1, 60
WAIT_CAP_MIN_S, WAIT_CAP_MAX_S = 5, 600

# Order category (web/src/domain/orderCatalog.ts OrderCategory) -> wait class.
CLASS_OF: dict[str, str] = {
    "poc": "poc", "lab": "lab", "coag": "lab", "cardiac": "lab", "other": "lab",
    "imaging-xr": "imaging", "imaging-ct": "imaging", "imaging-us": "imaging", "imaging-mri": "imaging",
    "micro-culture": "culture",
}


def _default_caps() -> dict[str, float]:
    return {"poc": 15, "lab": 45, "imaging": 90, "culture": 120}


class SimClockSettings(BaseModel):
    model_config = {"extra": "forbid"}

    scale: float = Field(default=6, ge=SCALE_MIN, le=SCALE_MAX)
    wait_cap_s: dict[str, float] = Field(default_factory=_default_caps)

    @field_validator("wait_cap_s")
    @classmethod
    def _caps(cls, v: dict[str, float]) -> dict[str, float]:
        if set(v) != set(WAIT_CLASSES):
            raise ValueError(f"wait_cap_s needs exactly {list(WAIT_CLASSES)}")
        for k, s in v.items():
            if not (WAIT_CAP_MIN_S <= float(s) <= WAIT_CAP_MAX_S):
                raise ValueError(f"wait_cap_s.{k} must be {WAIT_CAP_MIN_S} to {WAIT_CAP_MAX_S} s")
        return {k: v[k] for k in WAIT_CLASSES}

    def model_dump(self, **kw: Any) -> dict[str, Any]:  # ints stay ints on the wire
        d = super().model_dump(**kw)
        d["scale"] = _num(d["scale"])
        d["wait_cap_s"] = {k: _num(s) for k, s in d["wait_cap_s"].items()}
        return d


def _num(x: float) -> float | int:
    return int(x) if float(x).is_integer() else x


DEFAULTS = SimClockSettings()


def wait_class(category: str) -> str:
    return CLASS_OF.get(category, "lab")


def real_waits_s(settings: SimClockSettings, category: str, turnaround_min: float,
                 preliminary_min: Optional[float]) -> tuple[float, float]:
    """Real seconds from placing an order to its first report and to its final report."""
    cap = float(settings.wait_cap_s[wait_class(category)])
    per_min = 60.0 / float(settings.scale)
    first_min = preliminary_min if preliminary_min else turnaround_min
    first = min(first_min * per_min, cap)
    if not preliminary_min:
        return _num(round(first, 3)), _num(round(first, 3))
    final = first + min(max(0.0, turnaround_min - preliminary_min) * per_min, cap)
    return _num(round(first, 3)), _num(round(final, 3))


# Representative orders for the faculty preview (sim minutes from server/results/catalog.py).
PREVIEW: tuple[tuple[str, str, float, Optional[float]], ...] = (
    ("poc", "poc", 5, None),
    ("lab", "lab", 50, None),
    ("imaging", "imaging-ct", 250, 125),
    ("culture", "micro-culture", 2880, 1440),
)


def preview(settings: SimClockSettings) -> list[dict[str, Any]]:
    out = []
    for klass, category, minutes, prelim in PREVIEW:
        first, final = real_waits_s(settings, category, minutes, prelim)
        out.append({"class": klass, "turnaround_min": minutes, "preliminary_min": prelim,
                    "first_report_s": first, "final_s": final})
    return out


__all__ = ["CLASS_OF", "DEFAULTS", "SimClockSettings", "WAIT_CLASSES", "preview", "real_waits_s", "wait_class"]
