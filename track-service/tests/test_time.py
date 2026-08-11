from datetime import datetime, timezone

import main


class TestEnsureUtc:
    def test_naive_datetime_gets_utc_attached(self):
        naive = datetime(2026, 1, 1, 12, 0, 0)
        result = main.ensure_utc(naive)
        assert result.tzinfo == timezone.utc
        assert result.hour == 12

    def test_aware_utc_datetime_passthrough(self):
        aware = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        result = main.ensure_utc(aware)
        assert result == aware
        assert result.tzinfo == timezone.utc

    def test_non_utc_aware_datetime_converted(self):
        from datetime import timedelta

        tz = timezone(timedelta(hours=-5))
        aware = datetime(2026, 1, 1, 7, 0, 0, tzinfo=tz)
        result = main.ensure_utc(aware)
        assert result.tzinfo == timezone.utc
        assert result.hour == 12
