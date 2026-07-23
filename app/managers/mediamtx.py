"""MediaMTXManager — consome a API REST do MediaMTX."""

import logging
from typing import Optional

import httpx

logger = logging.getLogger("mediamtx")


class MediaMTXManager:
    """Gerencia paths e monitora o MediaMTX via API REST."""

    def __init__(self, api_url: str = "http://localhost:9997", timeout: int = 5):
        self.api_url = api_url.rstrip("/")
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(base_url=self.api_url, timeout=self.timeout)
        return self._client

    async def health(self) -> dict:
        """Verifica se o MediaMTX está respondendo."""
        try:
            client = self._get_client()
            resp = await client.get("/v3/paths/list")
            if resp.status_code == 200:
                return {"alive": True, "status_code": resp.status_code}
            return {"alive": False, "status_code": resp.status_code, "error": resp.text[:200]}
        except httpx.RequestError as e:
            return {"alive": False, "error": str(e)}

    async def list_paths(self) -> dict:
        """Retorna todas as paths do MediaMTX."""
        client = self._get_client()
        try:
            resp = await client.get("/v3/paths/list")
            if resp.status_code == 200:
                data = resp.json()
                return {"success": True, "data": data}
            return {"success": False, "error": resp.text[:200]}
        except httpx.RequestError as e:
            return {"success": False, "error": str(e)}

    async def get_path(self, name: str) -> dict:
        """Retorna detalhes de uma path específica."""
        client = self._get_client()
        try:
            resp = await client.get(f"/v3/paths/get/{name}")
            if resp.status_code == 200:
                return {"success": True, "data": resp.json()}
            return {"success": False, "error": resp.text[:200]}
        except httpx.RequestError as e:
            return {"success": False, "error": str(e)}

    async def add_path(self, name: str, config: Optional[dict] = None) -> dict:
        """Cria uma nova path no MediaMTX."""
        client = self._get_client()
        payload = config or {}
        try:
            resp = await client.post(f"/v3/paths/add/{name}", json=payload)
            if resp.status_code in (200, 201):
                return {"success": True, "name": name, "status_code": resp.status_code}
            return {"success": False, "error": resp.text[:200]}
        except httpx.RequestError as e:
            return {"success": False, "error": str(e)}

    async def delete_path(self, name: str) -> dict:
        """Remove uma path do MediaMTX."""
        client = self._get_client()
        try:
            resp = await client.delete(f"/v3/paths/delete/{name}")
            if resp.status_code in (200, 204):
                return {"success": True, "name": name}
            return {"success": False, "error": resp.text[:200]}
        except httpx.RequestError as e:
            return {"success": False, "error": str(e)}

    async def close(self):
        """Fecha a sessão HTTP."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
