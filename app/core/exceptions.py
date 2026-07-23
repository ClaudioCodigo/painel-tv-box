"""Exceções tipadas do painel."""


class PanelError(Exception):
    """Base para erros do painel."""


class DeviceNotFoundError(PanelError):
    """Dispositivo não encontrado."""


class ADBConnectionError(PanelError):
    """Falha na conexão ADB."""


class MediaMTXError(PanelError):
    """Erro de comunicação com MediaMTX API."""


class ConfigurationError(PanelError):
    """Erro de configuração."""


class WizardIncompleteError(PanelError):
    """Wizard ainda não foi concluído — painel bloqueado."""
