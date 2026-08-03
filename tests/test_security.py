"""Testes dos helpers de segurança (validação de input/SSRF/injeção)."""

from app.utils.system import (
    is_safe_id,
    is_safe_package,
    is_safe_network_target,
    is_safe_rtmp_url,
    is_safe_http_url_local,
)


class TestValidators:
    def test_is_safe_id(self):
        assert is_safe_id("qa")
        assert is_safe_id("tv-box_1")
        assert not is_safe_id("../../etc")
        assert not is_safe_id("a/b")
        assert not is_safe_id("..")

    def test_is_safe_package(self):
        assert is_safe_package("org.videolan.vlc")
        assert is_safe_package("com.example.App_1")
        assert not is_safe_package("evil; reboot")
        assert not is_safe_package("evil$(id)")
        assert not is_safe_package("a b")

    def test_is_safe_network_target(self):
        assert is_safe_network_target("192.168.254.102")
        assert is_safe_network_target("10.0.0.5")
        assert not is_safe_network_target("127.0.0.1")       # loopback (SSRF)
        assert not is_safe_network_target("169.254.1.1")     # link-local
        assert not is_safe_network_target("224.0.0.1")       # multicast
        assert not is_safe_network_target("0.0.0.0")         # unspecified
        assert not is_safe_network_target("not-an-ip")

    def test_is_safe_rtmp_url(self):
        assert is_safe_rtmp_url("rtmp://localhost:1935/SCRCPY_DISPLAY")
        assert is_safe_rtmp_url("rtmp://127.0.0.1:1935/x")
        assert is_safe_rtmp_url("rtmp://192.168.254.5:1935/x")
        assert not is_safe_rtmp_url("rtmp://evil.com/x")      # host público
        assert not is_safe_rtmp_url("http://localhost/x")     # scheme errado
        assert not is_safe_rtmp_url("rtmp://10.0.0.1@evil.com/x")

    def test_is_safe_http_url_local(self):
        assert is_safe_http_url_local("http://localhost:9997")
        assert is_safe_http_url_local("http://127.0.0.1:9997")
        assert is_safe_http_url_local("http://192.168.254.2:9997")
        assert not is_safe_http_url_local("http://169.254.169.254/latest/meta-data")  # cloud metadata
        assert not is_safe_http_url_local("https://api.github.com")
        assert not is_safe_http_url_local("ftp://localhost")
        assert not is_safe_http_url_local("not-a-url")
