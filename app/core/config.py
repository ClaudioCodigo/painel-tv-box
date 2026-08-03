"""ConfigurationManager — carrega, valida e salva toda configuração em YAML."""

import logging
import os
from pathlib import Path
from typing import Optional

from app.models.config import SystemConfig, WatchdogConfig, PlayersConfig, MediaMTXConfig
from app.models.device import DeviceConfig
from app.models.group import GroupConfig
from app.utils.yaml import load_yaml, dump_yaml, dump_yaml_simple
from app.utils.system import is_safe_id

logger = logging.getLogger("config")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class ConfigurationManager:
    """Gerencia toda a configuração do painel via YAML."""

    def __init__(self):
        self.config_dir = PROJECT_ROOT / "config"
        self.devices_dir = PROJECT_ROOT / "devices"
        self.groups_dir = PROJECT_ROOT / "groups"

        self.system: Optional[SystemConfig] = None
        self.watchdog: Optional[WatchdogConfig] = None
        self.players: Optional[PlayersConfig] = None
        self.mediamtx: Optional[MediaMTXConfig] = None

        self.devices: list[DeviceConfig] = []
        self.groups: list[GroupConfig] = []

        self.wizard_completed: bool = False

    # ── Load ──────────────────────────────────────────────

    async def load(self):
        """Carrega toda a configuração do disco."""
        self._ensure_dirs()

        self._load_system()
        self._load_watchdog()
        self._load_players()
        self._load_mediamtx()
        self._load_devices()
        self._load_groups()

        self.wizard_completed = self.system.wizard_completed if self.system else False

        logger.info(
            "Config carregada: wizard_completed=%s, devices=%d, groups=%d",
            self.wizard_completed,
            len(self.devices),
            len(self.groups),
        )

    def _ensure_dirs(self):
        for d in [self.config_dir, self.devices_dir, self.groups_dir]:
            d.mkdir(exist_ok=True)

    def _ensure_default_config(self, name: str):
        """Cria o config real a partir do template .example se ainda não existir."""
        path = self.config_dir / name
        if path.exists():
            return
        example = self.config_dir / f"{name}.example"
        if example.exists():
            import shutil

            shutil.copy(example, path)
            logger.info("Config criada a partir do template: %s", path)

    def _load_system(self):
        self._ensure_default_config("system.yml")
        path = self.config_dir / "system.yml"
        data = load_yaml(path)
        self.system = SystemConfig(**data) if data else SystemConfig()

        # Gera heartbeat_key se ainda não existir (usada pelo heartbeat device→servidor)
        if self.system and self.system.security and not self.system.security.heartbeat_key:
            import secrets

            self.system.security.heartbeat_key = secrets.token_urlsafe(32)
            self.save_system()
            logger.info("Heartbeat key gerada (config/system.yml → security.heartbeat_key)")

        # Propaga server_port do ADB para a env (Ideia 4 — ADBManager lê a env)
        if self.system and self.system.adb and self.system.adb.server_port:
            if not os.environ.get("PANEL_ADB_SERVER_PORT"):
                os.environ["PANEL_ADB_SERVER_PORT"] = str(self.system.adb.server_port)

    def _load_watchdog(self):
        self._ensure_default_config("watchdog.yml")
        path = self.config_dir / "watchdog.yml"
        data = load_yaml(path)
        self.watchdog = WatchdogConfig(**data) if data else WatchdogConfig()

    def _load_players(self):
        self._ensure_default_config("players.yml")
        path = self.config_dir / "players.yml"
        data = load_yaml(path)
        self.players = PlayersConfig(**data) if data else PlayersConfig()

    def _load_mediamtx(self):
        self._ensure_default_config("mediamtx.yml")
        path = self.config_dir / "mediamtx.yml"
        data = load_yaml(path)
        self.mediamtx = MediaMTXConfig(**data) if data else MediaMTXConfig()

    def _load_devices(self):
        self.devices = []
        if not self.devices_dir.is_dir():
            return
        for p in sorted(self.devices_dir.glob("*.yml")):
            data = load_yaml(p)
            if data:
                data.setdefault("id", p.stem)
                try:
                    self.devices.append(DeviceConfig(**data))
                except Exception as e:
                    logger.error("Erro ao carregar device %s: %s", p.name, e)

    def _load_groups(self):
        self.groups = []
        if not self.groups_dir.is_dir():
            return
        for p in sorted(self.groups_dir.glob("*.yml")):
            data = load_yaml(p)
            if data:
                data.setdefault("id", p.stem)
                try:
                    self.groups.append(GroupConfig(**data))
                except Exception as e:
                    logger.error("Erro ao carregar grupo %s: %s", p.name, e)

    # ── Save ──────────────────────────────────────────────

    def save_system(self):
        if self.system:
            self.system.wizard_completed = self.wizard_completed
            dump_yaml(self.config_dir / "system.yml", self.system.model_dump())

    def save_watchdog(self):
        if self.watchdog:
            dump_yaml(self.config_dir / "watchdog.yml", self.watchdog.model_dump())

    def save_players(self):
        if self.players:
            dump_yaml(self.config_dir / "players.yml", self.players.model_dump())

    def save_mediamtx(self):
        if self.mediamtx:
            dump_yaml(self.config_dir / "mediamtx.yml", self.mediamtx.model_dump())

    # ── Devices CRUD ──────────────────────────────────────

    def get_device(self, device_id: str) -> Optional[DeviceConfig]:
        for d in self.devices:
            if d.id == device_id:
                return d
        return None

    def add_device(self, device: DeviceConfig):
        if not is_safe_id(device.id):
            raise ValueError(f"ID de dispositivo inválido: {device.id!r}")
        existing = self.get_device(device.id)
        if existing:
            self.devices = [d for d in self.devices if d.id != device.id]
        self.devices.append(device)
        self._save_device(device)

    def update_device(self, device_id: str, data: dict) -> Optional[DeviceConfig]:
        device = self.get_device(device_id)
        if not device:
            return None
        updated_data = device.model_dump()
        # merge: ignora state se vier no payload
        data.pop("state", None)
        updated_data.update(data)
        # id não pode ser alterado para um valor inseguro
        if "id" in updated_data and not is_safe_id(updated_data["id"]):
            raise ValueError(f"ID de dispositivo inválido: {updated_data['id']!r}")
        new_device = DeviceConfig(**updated_data)
        self.devices = [d for d in self.devices if d.id != device_id]
        self.devices.append(new_device)
        self._save_device(new_device)
        return new_device

    def delete_device(self, device_id: str) -> bool:
        if not is_safe_id(device_id):
            raise ValueError(f"ID de dispositivo inválido: {device_id!r}")
        device = self.get_device(device_id)
        if not device:
            return False
        self.devices = [d for d in self.devices if d.id != device_id]
        path = self.devices_dir / f"{device_id}.yml"
        if path.is_file():
            path.unlink()
        return True

    def _save_device(self, device: DeviceConfig):
        if not is_safe_id(device.id):
            raise ValueError(f"ID de dispositivo inválido: {device.id!r}")
        dump_yaml(self.devices_dir / f"{device.id}.yml", device.model_dump_safe())

    # ── Groups CRUD ───────────────────────────────────────

    def get_group(self, group_id: str) -> Optional[GroupConfig]:
        for g in self.groups:
            if g.id == group_id:
                return g
        return None

    def add_group(self, group: GroupConfig):
        if not is_safe_id(group.id):
            raise ValueError(f"ID de grupo inválido: {group.id!r}")
        existing = self.get_group(group.id)
        if existing:
            self.groups = [g for g in self.groups if g.id != group.id]
        self.groups.append(group)
        self._save_group(group)

    def update_group(self, group_id: str, data: dict) -> Optional[GroupConfig]:
        group = self.get_group(group_id)
        if not group:
            return None
        updated_data = group.model_dump()
        updated_data.update(data)
        if "id" in updated_data and not is_safe_id(updated_data["id"]):
            raise ValueError(f"ID de grupo inválido: {updated_data['id']!r}")
        new_group = GroupConfig(**updated_data)
        self.groups = [g for g in self.groups if g.id != group_id]
        self.groups.append(new_group)
        self._save_group(new_group)
        return new_group

    def delete_group(self, group_id: str) -> bool:
        if not is_safe_id(group_id):
            raise ValueError(f"ID de grupo inválido: {group_id!r}")
        group = self.get_group(group_id)
        if not group:
            return False
        self.groups = [g for g in self.groups if g.id != group_id]
        path = self.groups_dir / f"{group_id}.yml"
        if path.is_file():
            path.unlink()
        return True

    def _save_group(self, group: GroupConfig):
        dump_yaml(self.groups_dir / f"{group.id}.yml", group.model_dump_safe())

    # ── Wizard ────────────────────────────────────────────

    def finalize_wizard(self):
        """Marca wizard como completo e salva todos YAMLs."""
        if self.system:
            self.system.wizard_completed = True
        self.wizard_completed = True
        self.save_system()
        self.save_watchdog()
        self.save_players()
        self.save_mediamtx()
        self.generate_mediamtx_yml()
        logger.info("Wizard finalizado com %d devices e %d grupos", len(self.devices), len(self.groups))

    def generate_mediamtx_yml(self, output_path: Path = None) -> Path:
        """Gera mediamtx.yml real com paths dos devices."""
        if output_path is None:
            output_path = self.config_dir / "mediamtx.generated.yml"

        base = self.mediamtx.model_dump() if self.mediamtx else {}

        # Paths: um por device com rtsp_path
        paths = {}
        for device in self.devices:
            if device.rtsp_path:
                paths[device.rtsp_path] = {
                    "source": "publisher",
                    "maxReaders": 1,
                }

        rtsp_port = base.get("server", {}).get("rtsp_port", 8554)
        rtmp_port = base.get("server", {}).get("rtmp_port", 1935)
        api_port = base.get("server", {}).get("api_port", 9997)

        config = {
            "logLevel": base.get("logLevel", "warn"),
            "writeQueueSize": base.get("writeQueueSize", 2048),
            "readTimeout": base.get("readTimeout", "10s"),
            "writeTimeout": base.get("writeTimeout", "10s"),
            "rtsp": True,
            "rtspAddress": f":{rtsp_port}",
            "rtspTransports": base.get("rtspTransports", ["udp", "tcp"]),
            "rtmp": True,
            "rtmpAddress": f":{rtmp_port}",
            "hls": base.get("hls", False),
            "webrtc": base.get("webrtc", False),
            "api": True,
            "apiAddress": f":{api_port}",
            "paths": paths,
            "authMethod": "internal",
            "authInternalUsers": [
                {"user": "any", "pass": "", "ips": [], "permissions": [{"action": "publish", "path": ""}, {"action": "read", "path": ""}, {"action": "playback", "path": ""}]},
                {"user": "any", "pass": "", "ips": ["127.0.0.1", "::1", base.get("api_allowed_network", "192.168.254.0/24")], "permissions": [{"action": "api"}, {"action": "metrics"}, {"action": "pprof"}]},
            ],
            "apiAllowOrigins": ["*"],
        }

        dump_yaml_simple(output_path, config)
        logger.info("MediaMTX config gerada: %s (%d paths)", output_path, len(paths))

        # Sincroniza com o config do serviço (managed deploy): se o env
        # PANEL_MEDIAMTX_CONFIG estiver setado e gravável, escreve lá também —
        # o wizard/update atualiza o MediaMTX em execução sem cópia manual.
        service_cfg = os.environ.get("PANEL_MEDIAMTX_CONFIG", "")
        if service_cfg and Path(service_cfg) != output_path:
            try:
                dest = Path(service_cfg)
                dump_yaml_simple(dest, config)
                logger.info("MediaMTX config sincronizada para o serviço: %s", dest)
            except Exception as e:
                logger.warning("Falha ao sincronizar config do MediaMTX (%s): %s", service_cfg, e)

        return output_path
