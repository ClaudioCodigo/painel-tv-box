"""LogManager — logs estruturados com múltiplas fontes."""

import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

LOG_FORMAT = "[%(asctime)s] [%(levelname)s] [%(name)s] [%(device)s] %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

LOG_SOURCES = ["system", "adb", "mediamtx", "watchdog", "user", "api"]

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
LOG_DIR = PROJECT_ROOT / "logs"


class DeviceFilter(logging.Filter):
    """Filter que adiciona device_id ao registro de log."""

    def __init__(self, device_id: str = ""):
        super().__init__()
        self.device_id = device_id

    def filter(self, record):
        record.device = self.device_id or "-"
        return True


class LogManager:
    """Gerencia logs com múltiplas fontes, busca e tail."""

    def __init__(self, log_dir: Optional[Path] = None):
        self.log_dir = log_dir or LOG_DIR
        self.log_dir.mkdir(exist_ok=True)
        self._loggers: dict[str, logging.Logger] = {}

    def setup(self):
        """Configura logging do sistema: um arquivo por fonte."""
        # Remove handlers padrão
        root = logging.getLogger()
        root.handlers.clear()

        for source in LOG_SOURCES:
            logger = logging.getLogger(source)
            logger.setLevel(logging.INFO)
            logger.handlers.clear()
            logger.addFilter(DeviceFilter())

            # File handler (um por fonte) com rotação
            from logging.handlers import RotatingFileHandler
            fh = RotatingFileHandler(
                self.log_dir / f"{source}.log",
                maxBytes=5 * 1024 * 1024,  # 5 MB por arquivo
                backupCount=3,              # manter 3 backups
                encoding="utf-8",
            )
            fh.setFormatter(logging.Formatter(LOG_FORMAT, DATE_FORMAT))
            logger.addHandler(fh)

            self._loggers[source] = logger

        # Console (também envia pra stdout)
        ch = logging.StreamHandler()
        ch.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s", DATE_FORMAT))
        root.addHandler(ch)
        root.setLevel(logging.INFO)

        # Obs: system.log é escrito apenas pelo RotatingFileHandler da fonte
        # "system" acima. Um FileHandler extra no root causava dois handles
        # abertos no mesmo arquivo, quebrando a rotação no Windows
        # (PermissionError ao renomear arquivo em uso) e duplicando linhas.

        self.info("system", "LogManager inicializado")

    def get_logger(self, source: str) -> logging.Logger:
        """Retorna logger para uma fonte."""
        if source not in self._loggers:
            return logging.getLogger(source)
        return self._loggers[source]

    def log(self, source: str, level: str, message: str, device_id: str = ""):
        """Escreve log em fonte específica."""
        logger = self.get_logger(source)
        extra = {"device": device_id}
        level_map = {
            "DEBUG": logger.debug,
            "INFO": logger.info,
            "WARNING": logger.warning,
            "ERROR": logger.error,
            "CRITICAL": logger.critical,
        }
        fn = level_map.get(level.upper(), logger.info)
        fn(message, extra=extra)

    def info(self, source: str, message: str, device_id: str = ""):
        self.log(source, "INFO", message, device_id)

    def error(self, source: str, message: str, device_id: str = ""):
        self.log(source, "ERROR", message, device_id)

    def warning(self, source: str, message: str, device_id: str = ""):
        self.log(source, "WARNING", message, device_id)

    # ── Search ─────────────────────────────────

    def search(self, source: Optional[str] = None, level: Optional[str] = None,
               device_id: Optional[str] = None, q: Optional[str] = None,
               from_date: Optional[str] = None, to_date: Optional[str] = None,
               page: int = 1, per_page: int = 50) -> dict:
        """Busca logs com filtros. Paginação: 1-indexed."""
        sources = [source] if source else LOG_SOURCES
        all_lines = []

        for src in sources:
            path = self.log_dir / f"{src}.log"
            if not path.is_file():
                continue
            lines = self._parse_file(path, src)
            all_lines.extend(lines)

        # Ordena por timestamp (do mais recente para o mais antigo)
        all_lines.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

        # Filtros
        filtered = all_lines
        if level:
            filtered = [l for l in filtered if l.get("level", "").upper() == level.upper()]
        if device_id:
            filtered = [l for l in filtered if device_id.lower() in l.get("device", "").lower()]
        if q:
            filtered = [l for l in filtered if q.lower() in l.get("message", "").lower()]
        if from_date or to_date:
            from_dt = self._parse_ts(from_date) if from_date else None
            to_dt = self._parse_ts(to_date) if to_date else None
            filtered = [l for l in filtered if self._date_in_range(l.get("timestamp", ""), from_dt, to_dt)]

        total = len(filtered)
        start = (page - 1) * per_page
        end = start + per_page
        items = filtered[start:end]

        return {
            "items": items,
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": (total + per_page - 1) // per_page,
        }

    def tail(self, source: Optional[str] = None, n: int = 50) -> list[dict]:
        """Retorna últimas N linhas de log."""
        sources = [source] if source else LOG_SOURCES
        all_lines = []

        for src in sources:
            path = self.log_dir / f"{src}.log"
            if not path.is_file():
                continue
            lines = self._parse_file(path, src)
            all_lines.extend(lines)

        all_lines.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        return all_lines[:n]

    def get_sources(self) -> list[dict]:
        """Retorna fontes disponíveis com contagem de linhas."""
        result = []
        for src in LOG_SOURCES:
            path = self.log_dir / f"{src}.log"
            count = sum(1 for _ in open(path, encoding="utf-8")) if path.is_file() else 0
            size = path.stat().st_size if path.is_file() else 0
            result.append({"name": src, "lines": count, "size_bytes": size})
        return result

    def download(self, source: Optional[str] = None) -> Path | None:
        """Retorna path do arquivo de log para download."""
        if source:
            path = self.log_dir / f"{source}.log"
            return path if path.is_file() else None

        # Se não especificar fonte, cria um merged temporário
        merged = self.log_dir / "all_logs.log"
        with open(merged, "w", encoding="utf-8") as out:
            for src in LOG_SOURCES:
                p = self.log_dir / f"{src}.log"
                if p.is_file():
                    out.write(f"=== {src} ===\n")
                    out.write(p.read_text(encoding="utf-8"))
                    out.write("\n")
        return merged if merged.is_file() else None

    # ── Parser ─────────────────────────────────

    _LOG_PATTERN = re.compile(
        r"\[(?P<timestamp>[^\]]+)\] \[(?P<level>[^\]]+)\] \[(?P<source>[^\]]+)\] \[(?P<device>[^\]]+)\] (?P<message>.+)"
    )

    @staticmethod
    def _parse_ts(value: str) -> Optional[datetime]:
        """Converte timestamp de log (ou data 'YYYY-MM-DD') em datetime."""
        value = (value or "").strip()
        if not value:
            return None
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                continue
        return None

    @classmethod
    def _date_in_range(cls, ts_str: str, from_dt: Optional[datetime], to_dt: Optional[datetime]) -> bool:
        """Verifica se um timestamp de log está no intervalo [from, to].
        Datas sem hora ('YYYY-MM-DD') valem o dia inteiro.
        """
        if not from_dt and not to_dt:
            return True
        ts = cls._parse_ts(ts_str)
        if ts is None:
            return False
        if from_dt and ts < from_dt:
            return False
        if to_dt:
            end = to_dt
            if to_dt.hour == 0 and to_dt.minute == 0 and to_dt.second == 0:
                end = to_dt.replace(hour=23, minute=59, second=59)
            if ts > end:
                return False
        return True

    def _parse_file(self, path: Path, source: str) -> list[dict]:
        """Parse arquivo de log usando regex."""
        lines = []
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    m = self._LOG_PATTERN.match(line)
                    if m:
                        lines.append({
                            "timestamp": m.group("timestamp"),
                            "level": m.group("level"),
                            "source": m.group("source"),
                            "device": m.group("device"),
                            "message": m.group("message"),
                            "raw": line,
                        })
                    else:
                        # Linha que não bate o padrão (ex: cabeçalho)
                        lines.append({
                            "timestamp": "",
                            "level": "",
                            "source": source,
                            "device": "",
                            "message": line,
                            "raw": line,
                        })
        except Exception:
            pass
        return lines
