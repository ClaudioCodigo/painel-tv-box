"""ConfigurationManager — carrega, valida e salva toda configuração em YAML."""

import logging
from pathlib import Path
from typing import Optional

from app.models.config import SystemConfig, WatchdogConfig, PlayersConfig, MediaMTXConfig
from app.models.device import DeviceConfig
from app.models.group import GroupConfig
from app.utils.yaml import load_yaml, dump_yaml, dump_yaml_simple

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

    def _load_system(self):
        path = self.config_dir / "system.yml"
        data = load_yaml(path)
        self.system = SystemConfig(**data) if data else SystemConfig()

    def _load_watchdog(self):
        path = self.config_dir / "watchdog.yml"
        data = load_yaml(path)
        self.watchdog = WatchdogConfig(**data) if data else WatchdogConfig()

    def _load_players(self):
        path = self.config_dir / "players.yml"
        data = load_yaml(path)
        self.players = PlayersConfig(**data) if data else PlayersConfig()

    def _load_mediamtx(self):
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
        new_device = DeviceConfig(**updated_data)
        self.devices = [d for d in self.devices if d.id != device_id]
        self.devices.append(new_device)
        self._save_device(new_device)
        return new_device

    def delete_device(self, device_id: str) -> bool:
        device = self.get_device(device_id)
        if not device:
            return False
        self.devices = [d for d in self.devices if d.id != device_id]
        path = self.devices_dir / f"{device_id}.yml"
        if path.is_file():
            path.unlink()
        return True

    def _save_device(self, device: DeviceConfig):
        dump_yaml(self.devices_dir / f"{device.id}.yml", device.model_dump_safe())

    # ── Groups CRUD ───────────────────────────────────────

    def get_group(self, group_id: str) -> Optional[GroupConfig]:
        for g in self.groups:
            if g.id == group_id:
                return g
        return None

    def add_group(self, group: GroupConfig):
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
        new_group = GroupConfig(**updated_data)
        self.groups = [g for g in self.groups if g.id != group_id]
        self.groups.append(new_group)
        self._save_group(new_group)
        return new_group

    def delete_group(self, group_id: str) -> bool:
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
        return output_path
