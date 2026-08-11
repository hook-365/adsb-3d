import main


class TestDefaultPollSeconds:
    def test_docker_service_name_is_local(self):
        assert main._default_poll_seconds("http://ultrafeeder") == 1.0

    def test_dotless_hostname_no_scheme_is_local(self):
        assert main._default_poll_seconds("ultrafeeder") == 1.0

    def test_private_ip_is_local(self):
        assert main._default_poll_seconds("http://192.168.1.5") == 1.0

    def test_loopback_ip_is_local(self):
        assert main._default_poll_seconds("http://127.0.0.1") == 1.0

    def test_public_ip_is_remote(self):
        assert main._default_poll_seconds("http://8.8.8.8") == 5.0

    def test_public_dns_name_is_remote(self):
        assert main._default_poll_seconds("http://example.com") == 5.0

    def test_public_dns_name_with_path_is_remote(self):
        assert main._default_poll_seconds("https://feeder.example.com:8080/data") == 5.0
