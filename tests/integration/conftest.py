"""
Make the pure modules importable without Home Assistant.

`custom_components/family_tracking/__init__.py` imports Home Assistant, so a
plain `import family_tracking.tracker` would drag the whole of it in. These
tests only exercise pure functions, and installing Home Assistant in CI to check
a few of those would turn a two-second run into a two-minute one.

Registering a bare package object with the right `__path__` lets the relative
imports inside those modules resolve while the real `__init__` never runs.
"""

import sys
import types
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[2] / "custom_components" / "family_tracking"

if "family_tracking" not in sys.modules:
    stub = types.ModuleType("family_tracking")
    stub.__path__ = [str(PACKAGE)]
    sys.modules["family_tracking"] = stub
