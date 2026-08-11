import main


class TestHasMeaningfulChange:
    def test_identical_records_no_change(self):
        old = {"lat": 45.0, "lon": -90.0, "flight": "UAL1", "seen": 1}
        new = {"lat": 45.0, "lon": -90.0, "flight": "UAL1", "seen": 5}
        assert main._has_meaningful_change(old, new) is False

    def test_seen_only_change_is_not_meaningful(self):
        # `seen` isn't in WS_DIFF_FIELDS at all — ticks every second for
        # every aircraft and would defeat the diff if it counted.
        old = {"lat": 45.0, "seen": 1}
        new = {"lat": 45.0, "seen": 999}
        assert main._has_meaningful_change(old, new) is False

    def test_each_diff_field_appearing_is_meaningful(self):
        for field in main.WS_DIFF_FIELDS:
            old = {}
            new = {field: "some-value"}
            assert main._has_meaningful_change(old, new) is True, field

    def test_each_diff_field_disappearing_is_meaningful(self):
        for field in main.WS_DIFF_FIELDS:
            old = {field: "some-value"}
            new = {}
            assert main._has_meaningful_change(old, new) is True, field

    def test_each_diff_field_value_change_is_meaningful(self):
        for field in main.WS_DIFF_FIELDS:
            old = {field: 1}
            new = {field: 2}
            assert main._has_meaningful_change(old, new) is True, field

    def test_empty_dicts_no_change(self):
        assert main._has_meaningful_change({}, {}) is False


class TestFeederAgeSeconds:
    def test_none_before_first_fetch(self, monkeypatch):
        monkeypatch.setattr(main, "latest_feeder_fetched_monotonic", 0.0)
        assert main._feeder_age_seconds() is None

    def test_returns_elapsed_seconds_after_a_fetch(self, monkeypatch):
        import time

        fetched_at = time.monotonic() - 5.0
        monkeypatch.setattr(main, "latest_feeder_fetched_monotonic", fetched_at)
        age = main._feeder_age_seconds()
        assert age is not None
        assert age >= 4.9
