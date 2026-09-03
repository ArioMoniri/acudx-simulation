"""AcuDx backend gateway package (Phase-0 / MVP).

The pod-side chokepoint in front of the local open-weight model stack. Every
model call flows through :mod:`server.model_gateway`, and the ``AIRGAPPED``
no-egress invariant is enforced in :mod:`server.config`.

See ``server/README.md`` for how this maps to ``docs/architecture`` and how to
run it on the GPU pod.
"""

from __future__ import annotations

__version__ = "0.1.0"

from server.config import Settings, get_settings

__all__ = ["Settings", "get_settings", "__version__"]
