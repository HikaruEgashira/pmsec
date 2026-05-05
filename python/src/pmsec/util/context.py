from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Context:
    env: dict[str, str]
    home: Path
    platform: str
