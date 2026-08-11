import pytest
from fastapi import HTTPException

import main


class TestResolveResolution:
    def test_full_is_raw_with_no_bucket(self):
        mode, bucket = main._resolve_resolution("full")
        assert mode == "raw"
        assert bucket is None

    def test_1s_collapses_to_raw(self):
        mode, bucket = main._resolve_resolution("1s")
        assert mode == "raw"
        assert bucket is None

    def test_valid_bucket_seconds(self):
        mode, bucket = main._resolve_resolution("15s")
        assert mode == "bucket"
        assert bucket == 15

    def test_max_valid_bucket(self):
        mode, bucket = main._resolve_resolution("3600s")
        assert mode == "bucket"
        assert bucket == 3600

    def test_zero_seconds_rejected(self):
        with pytest.raises(HTTPException) as exc:
            main._resolve_resolution("0s")
        assert exc.value.status_code == 400

    def test_over_max_rejected(self):
        with pytest.raises(HTTPException) as exc:
            main._resolve_resolution("3601s")
        assert exc.value.status_code == 400


class TestAutodownsample:
    def test_bucket_mode_passthrough_unchanged(self):
        mode, bucket, note = main._autodownsample_if_window_too_wide("bucket", 15, 999_999_999)
        assert mode == "bucket"
        assert bucket == 15
        assert note is None

    def test_raw_within_window_passthrough(self):
        mode, bucket, note = main._autodownsample_if_window_too_wide(
            "raw", None, main.RAW_FULL_MAX_WINDOW_SECONDS - 1
        )
        assert mode == "raw"
        assert bucket is None
        assert note is None

    def test_raw_over_window_auto_buckets(self):
        window = main.RAW_FULL_MAX_WINDOW_SECONDS + 1
        mode, bucket, note = main._autodownsample_if_window_too_wide("raw", None, window)
        assert mode == "bucket"
        assert bucket is not None
        assert bucket >= 2
        assert note == f"{bucket}s (auto)"

    def test_auto_bucket_clamped_to_3600(self):
        # An enormous window should clamp the computed bucket to the
        # _resolve_resolution validation ceiling, not exceed it.
        huge_window = main.AUTO_DOWNSAMPLE_TARGET_POINTS * 100_000
        mode, bucket, note = main._autodownsample_if_window_too_wide("raw", None, huge_window)
        assert mode == "bucket"
        assert bucket == 3600
