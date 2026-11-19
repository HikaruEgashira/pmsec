from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Context:
    env: dict[str, str]
    home: Path
    platform: str
    force: bool = False
    # HOME as seen by the OS; differs from `home` when PMSEC_HOME is set.
    os_home: Path | None = None
