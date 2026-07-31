"""Application lifecycle: startup and shutdown hooks."""

import logging

logger = logging.getLogger("system")


async def startup(fastapi_app):
    """Roda no startup do uvicorn."""
    from app.core.config import ConfigurationManager
    from app.core.websocket import WebSocketHub

    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
    )

    # Carrega configuração
    cm = ConfigurationManager()
    await cm.load()

    # Garante token de acesso (gera + loga o caminho no 1º boot)
    from app.core.auth import get_or_create_token

    get_or_create_token()

    # Injeta no módulo main
    import app.main

    app.main.config = cm
    logger.info(f"Config carregada. Wizard: {'pendente' if not cm.wizard_completed else 'completo'}. Devices: {len(cm.devices)}")

    # Inicializa WebSocket hub
    hub = WebSocketHub()
    fastapi_app.state.ws_hub = hub

    # Inicializa LogManager (substitui logging básico)
    from app.managers.log import LogManager

    log_mgr = LogManager()
    log_mgr.setup()
    fastapi_app.state.log_manager = log_mgr
    logger.info("LogManager inicializado")

    # Inicializa MetricsHistory
    from app.utils.metrics import MetricsHistory

    metrics_hist = MetricsHistory()
    fastapi_app.state.metrics_history = metrics_hist
    logger.info("MetricsHistory inicializado")

    # Inicializa Watchdog se config completa
    if cm.wizard_completed and cm.devices:
        from app.managers.adb import ADBManager
        from app.managers.health import HealthManager
        from app.managers.mediamtx import MediaMTXManager
        from app.managers.player import PlayerManager
        from app.managers.watchdog import WatchdogManager
        from app.services.recovery import RecoveryService

        adb = ADBManager()
        mtx_mgr = MediaMTXManager(
            api_url=cm.mediamtx.api.url if cm.mediamtx and hasattr(cm.mediamtx, "api") else "http://localhost:9997",
        )
        player_mgr = PlayerManager(adb_manager=adb, players_config=cm.players)

        health_mgr = HealthManager(
            adb_manager=adb,
            mediamtx_manager=mtx_mgr,
            players_config=cm.players,
            heartbeat_timeout=cm.watchdog.heartbeat_timeout if cm.watchdog else 60,
        )

        recovery_svc = RecoveryService(adb_manager=adb, player_manager=player_mgr, watchdog_config=cm.watchdog)

        watchdog = WatchdogManager(health_manager=health_mgr, recovery_service=recovery_svc, config=cm.watchdog)

        async def send_event(event: dict):
            """Broadcast evento do watchdog via WebSocket."""
            try:
                await hub.broadcast(event)
            except Exception:
                pass

        watchdog.set_event_broadcast(send_event)
        watchdog.start(cm.devices)
        fastapi_app.state.watchdog = watchdog
        logger.info("Watchdog iniciado para %d dispositivos", len(cm.devices))

        # Inicializa ScheduleManager
        from app.managers.schedule import ScheduleManager

        adb_schedule = ADBManager()
        player_schedule = PlayerManager(adb_manager=adb_schedule, players_config=cm.players, host_ip=cm.system.host.ip, rtsp_port=cm.mediamtx.server.rtsp_port)
        sched_mgr = ScheduleManager(config_manager=cm, adb_manager=adb_schedule, player_manager=player_schedule)
        sched_mgr.start()
        fastapi_app.state.schedule_manager = sched_mgr
        logger.info("ScheduleManager iniciado")

    logger.info("Painel TV Box iniciado")


async def shutdown(fastapi_app):
    """Roda no shutdown do uvicorn."""
    # Para watchdog
    watchdog = getattr(fastapi_app.state, "watchdog", None)
    if watchdog:
        watchdog.stop()
        logger.info("Watchdog parado")
    logger.info("Painel TV Box encerrado")
