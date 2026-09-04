"""Fail CI when obviously sensitive material is tracked in the public repo.

This intentionally scans the current tree, not Git history. Historical secret
removal is a separate operation and exposed credentials must be rotated first.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SENSITIVE_BASENAMES = {
    "adbkey",
    ".panel_token",
    ".session_secret",
    "admin.json",
    "heartbeat.conf",
}

SENSITIVE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "private key",
        re.compile(r"-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----"),
    ),
    (
        "GitHub token",
        re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"),
    ),
    (
        "AWS access key",
        re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    ),
    (
        "heartbeat key",
        re.compile(r"(?im)^\s*heartbeat_key\s*:\s*[A-Za-z0-9_-]{20,}\s*$"),
    ),
    (
        "heartbeat.conf KEY",
        re.compile(r"(?im)^\s*KEY\s*=\s*[A-Za-z0-9_-]{20,}\s*$"),
    ),
)


def tracked_files() -> list[Path]:
    raw = subprocess.check_output(
        ["git", "ls-files", "-z"], cwd=ROOT
    ).decode("utf-8", errors="strict")
    return [ROOT / item for item in raw.split("\0") if item]


def main() -> int:
    findings: list[str] = []

    for path in tracked_files():
        rel = path.relative_to(ROOT)
        name = path.name.lower()

        if name in SENSITIVE_BASENAMES or (
            name.startswith(".env") and name != ".env.example"
        ):
            findings.append(f"sensitive filename tracked: {rel}")
            continue

        try:
            if path.stat().st_size > 2_000_000:
                continue
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        for label, pattern in SENSITIVE_PATTERNS:
            if pattern.search(text):
                findings.append(f"{label} pattern found: {rel}")

    if findings:
        print("Public repository safety check FAILED:\n")
        for finding in findings:
            print(f" - {finding}")
        print("\nRemove the material from the commit and rotate any exposed credential.")
        return 1

    print("Public repository safety check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
