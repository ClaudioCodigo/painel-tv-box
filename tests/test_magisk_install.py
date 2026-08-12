"""Teste unitário da navegação do MagiskInstaller com mocks."""
import pytest
from unittest.mock import AsyncMock, MagicMock
from app.services.magisk_install import MagiskInstaller
from app.models.device import DeviceConfig

class TestMagiskNav:
    def test_find_button(self):
        xml = '<node text="Instalação direta (recomendada)" bounds="[100,200][300,400]"/>'
        btn = MagiskInstaller._find_button(xml, "Instalação direta")
        assert btn == (200, 300)

    def test_find_button_sem_match(self):
        assert MagiskInstaller._find_button("<node text='x'/>", "nada") is None

    def test_has_text(self):
        assert MagiskInstaller._has_text("abc Instalado def", "Instalado")
        assert not MagiskInstaller._has_text("abc", "Instalado")

    @pytest.mark.asyncio
    async def test_install_apk_ausente(self):
        inst = MagiskInstaller(adb_manager=AsyncMock(), apk_path=MagicMock(is_file=MagicMock(return_value=False)))
        dev = DeviceConfig(id="t", ip="1.2.3.4")
        r = await inst.install(dev, reboot=False)
        assert r["success"] is False
        assert "APK não encontrado" in r["error"]
