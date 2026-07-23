"""Helpers para YAML — load/dump com pyyaml."""

from pathlib import Path
from typing import Any

import yaml


def load_yaml(path: Path) -> dict:
    """Carrega YAML de um arquivo. Retorna dict vazio se não existir ou inválido."""
    if not path.is_file():
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def dump_yaml(path: Path, data: dict):
    """Salva dict como YAML, garantindo que diretório pai existe."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def dump_yaml_simple(path: Path, data: dict):
    """Salva YAML sem flow style (para mediamtx.yml gerado)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
