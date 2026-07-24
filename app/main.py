"""Painel TV Box — entrypoint FastAPI."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.core.config import ConfigurationManager

from app.api.devices import router as devices_router
from app.api.system import router as system_router
from app.api.wizard import router as wizard_router
from app.api.mediamtx import router as mediamtx_router
from app.api.logs import router as logs_router
from app.api.backup import router as backup_router
from app.api.update import router as update_router
from app.api.groups import router as groups_router
from app.api.scrcpy import router as scrcpy_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.core.lifecycle import startup, shutdown

    await startup(app)
    yield
    await shutdown(app)


app = FastAPI(
    title="Painel TV Box",
    description="Gerenciamento e monitoramento de TV Boxes Android",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Config singleton (carregado no startup)
config: ConfigurationManager = None  # type: ignore[assignment]

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = PROJECT_ROOT / "static"
TEMPLATES_DIR = PROJECT_ROOT / "templates"

# Registra routers
app.include_router(devices_router)
app.include_router(system_router)
app.include_router(wizard_router)
app.include_router(mediamtx_router)
app.include_router(logs_router)
app.include_router(backup_router)
app.include_router(update_router)
app.include_router(groups_router)
app.include_router(scrcpy_router)


# --- API health check ---


@app.get("/api/system/health")
async def system_health():
    return {
        "status": "ok",
        "version": "0.1.0",
        "wizard_completed": config.wizard_completed if config else False,
    }


@app.get("/api/system/metrics")
async def system_metrics():
    from app.utils.system import get_metrics

    m = get_metrics()

    # Amostra histórico se disponível
    import app.main as main_module
    hist = getattr(main_module.app.state, "metrics_history", None)
    if hist:
        hist.sample()

    return m


@app.get("/api/system/metrics/history")
async def system_metrics_history(last_n: int = 30):
    """Retorna histórico de métricas para sparklines."""
    import app.main as main_module
    hist = getattr(main_module.app.state, "metrics_history", None)
    if not hist:
        return {"cpu": [], "ram": [], "disk": [], "count": 0}
    return hist.get_history(last_n=max(2, min(last_n, 60)))


# --- WebSocket ---


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    from app.main import app as current_app

    hub = current_app.state.ws_hub
    await hub.connect(ws)
    try:
        while True:
            data = await ws.receive_json()
            # Futuro: processar subscriptions, comandos, etc.
            await ws.send_json({"type": "ack", "echo": data})
    except WebSocketDisconnect:
        await hub.disconnect(ws)
    except Exception:
        await hub.disconnect(ws)


@app.websocket("/ws/shell/{device_id}")
async def websocket_shell(ws: WebSocket, device_id: str):
    """Shell remoto via WebSocket — output em tempo real."""
    from app.managers.adb import ADBManager
    import asyncio

    await ws.accept()
    device = config.get_device(device_id) if config else None
    if not device:
        await ws.send_json({"type": "error", "message": "Dispositivo não encontrado"})
        await ws.close()
        return

    adb = ADBManager()
    await ws.send_json({"type": "connected", "device_id": device_id, "ip": device.ip})

    try:
        while True:
            data = await ws.receive_json()
            command = data.get("command", "").strip()
            if not command:
                continue

            # Echo do comando
            await ws.send_json({"type": "stdin", "data": f"$ {command}"})

            # Executa ADB shell com streaming de output
            target = f"{device.ip}:{device.adb_port}"
            await adb.connect(device.ip, device.adb_port)
            proc = await asyncio.create_subprocess_exec(
                adb.binary, "-s", target, "shell", command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            # Stream stdout em tempo real
            output_lines = []
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                decoded = line.decode(errors="replace").rstrip("\n\r")
                output_lines.append(decoded)
                await ws.send_json({"type": "stdout", "data": decoded})

            stderr = await proc.stderr.read()
            await proc.wait()

            # Finaliza
            await ws.send_json({
                "type": "exit",
                "code": proc.returncode,
                "stderr": stderr.decode(errors="replace")[:500] if stderr else "",
            })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await ws.send_json({"type": "error", "message": str(e)[:300]})
        except Exception:
            pass


# --- Serve static files (com cache 1h) ---

app.mount("/static", StaticFiles(directory=str(STATIC_DIR), html=False), name="static")


@app.middleware("http")
async def static_cache_middleware(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static/"):
        # CSS e imagens: cache 1h. JS: sem cache (dev)
        if request.url.path.endswith(".js"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        else:
            response.headers["Cache-Control"] = "public, max-age=3600"
    return response


# --- Catch-all: serve o SPA (todas as rotas caem no base.html) ---


@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    path = TEMPLATES_DIR / full_path
    if path.is_file():
        return FileResponse(path)
    return FileResponse(TEMPLATES_DIR / "base.html")
