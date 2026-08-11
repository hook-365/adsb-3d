from datetime import datetime, timedelta, timezone

import main


class FakeCollector:
    def __init__(self, hub_connected: bool, stats: dict):
        self.hub_connected = hub_connected
        self.stats = stats


class TestHubStatusPayload:
    def test_no_collector_instance_reports_disconnected_defaults(self, monkeypatch):
        monkeypatch.setattr(main, 'collector_instance', None)
        payload = main._hub_status_payload()
        assert payload == {
            'hub_connected': False,
            'last_message_age_s': None,
            'messages_received': 0,
        }

    def test_connected_with_no_messages_yet(self, monkeypatch):
        fake = FakeCollector(True, {'messages_received': 0, 'last_message_time': None})
        monkeypatch.setattr(main, 'collector_instance', fake)
        payload = main._hub_status_payload()
        assert payload['hub_connected'] is True
        assert payload['last_message_age_s'] is None
        assert payload['messages_received'] == 0

    def test_reports_age_of_last_message(self, monkeypatch):
        last = datetime.now(timezone.utc) - timedelta(seconds=12)
        fake = FakeCollector(True, {'messages_received': 42, 'last_message_time': last})
        monkeypatch.setattr(main, 'collector_instance', fake)
        payload = main._hub_status_payload()
        assert payload['hub_connected'] is True
        assert payload['messages_received'] == 42
        assert payload['last_message_age_s'] >= 11.5

    def test_hub_disconnected_but_collector_present(self, monkeypatch):
        fake = FakeCollector(False, {'messages_received': 3, 'last_message_time': None})
        monkeypatch.setattr(main, 'collector_instance', fake)
        payload = main._hub_status_payload()
        assert payload['hub_connected'] is False
        assert payload['messages_received'] == 3
