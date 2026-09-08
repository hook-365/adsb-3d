"""Tests for decoder.decode_message — Tier 1 text formats + Tier 2 libacars."""
import decoder


class TestPositionReports:
    def test_m1_full_position_report(self):
        # Real UA2005 sample from the Weston feed.
        d = decoder.decode_message(
            "H1",
            "#M1BPOSN44046W089578,ROBBY,021948,320,KBULL,022323,ZZING,M38,259039,757F7B",
        )
        assert d["kind"] == "position"
        assert d["position"]["lat"] == 44.07667
        assert d["position"]["lon"] == -89.96333
        assert d["flight_level"] == 320
        assert d["next_waypoint"] == "KBULL"
        assert "over ROBBY" in d["summary"]
        assert "02:19:48Z" in d["summary"]
        assert "FL320" in d["summary"]
        assert "next KBULL ETA 02:23:23Z" in d["summary"]
        assert "SAT -38°C" in d["summary"]
        assert "wind 259°/39kt" in d["summary"]

    def test_decimal_position_fallback(self):
        d = decoder.decode_message("12", "N 45.828,W 90.852,38000,020919, 158,.C-GFJM,0434")
        assert d["kind"] == "position"
        assert d["position"]["lat"] == 45.828
        assert d["position"]["lon"] == -90.852
        assert d["altitude_ft"] == 38000

    def test_no_coords_no_position(self):
        assert decoder.decode_message("H1", "OPS NORMAL") is None


class TestArrivalAndWeather:
    def test_inrange(self):
        d = decoder.decode_message("80", "3701 INRANG 0306/01 KSEA/KBOS .N236AK\n/ETA 0225")
        assert d["kind"] == "arrival"
        assert d["origin"] == "KSEA"
        assert d["destination"] == "KBOS"
        assert "ETA 02:25Z" in d["summary"]

    def test_weather_request(self):
        d = decoder.decode_message(
            "5U", "  01 WXRQ   0306/01 KSEA/KBOS .N236AK\n/TYP 1/STA KSYR/STA KJFK/STA KEWR"
        )
        assert d["kind"] == "wxrq"
        assert d["stations"] == ["KSYR", "KJFK", "KEWR"]


class TestAtsClassification:
    def test_afn_preamble(self):
        d = decoder.decode_message("B0", "/USADCXA.AFN/FMHCSG2548,.B-2081,780654,003704/FCPYWGE2YA,096F4")
        assert d["kind"] == "afn"
        assert d["facility"] == "USADCXA"
        assert "AFN" in d["summary"]

    def test_cpdlc_at1(self):
        d = decoder.decode_message("BA", "/USADCXA.AT1.N302DN638E1CE500B49E")
        assert d["kind"] == "cpdlc"
        assert d["facility"] == "USADCXA"


class TestLibacarsPassthrough:
    def test_libacars_decode_wins_over_text(self):
        raw = {"label": "BA", "text": "/USADCXA.AT1.abcd", "libacars": {"cpdlc": {"msg": "CLIMB"}}}
        d = decoder.decode_message("BA", raw["text"], raw=raw)
        assert d["kind"] == "ats"
        assert "CPDLC (decoded)" in d["summary"]
        assert d["libacars"]["cpdlc"]["msg"] == "CLIMB"

    def test_libacars_list_shape(self):
        raw = {"text": "x", "decoded": [{"adsc": {}}, {"afn": {}}]}
        d = decoder.decode_message("H1", "x", raw=raw)
        assert "ADS-C" in d["summary"] and "AFN" in d["summary"]


class TestAtsWrappedForms:
    def test_media_advisory_wrapped_cpdlc(self):
        # Real AS0675 sample: #M1B/BA prefix wrapping an AT1 CPDLC payload.
        d = decoder.decode_message("H1", "#M1B/BA USADCXA.AT1.N956AK681E285C00F5C8")
        assert d["kind"] == "cpdlc"
        assert d["facility"] == "USADCXA"

    def test_non_ats_dotted_text_not_matched(self):
        assert decoder.decode_message("H1", "OPS.OK normal ops") is None


class TestDfbPositionReport:
    def test_dfb_with_route_and_temp(self):
        d = decoder.decode_message(
            "H1", "#DFBD3M002KBOSKSEAN45125W08945402333600M049265055G0009"
        )
        assert d["kind"] == "position"
        assert d["origin"] == "KBOS" and d["destination"] == "KSEA"
        assert d["position"]["lat"] == 45.20833
        assert d["position"]["lon"] == -89.75667
        assert "SAT -49°C" in d["summary"]


class TestDfbAbsVariant:
    def test_abs_route_with_decimal_position(self):
        d = decoder.decode_message("H1", "#DFBABS001DA_N973AK  KSEAKBOS555\r\n 45559 -88415024")
        assert d["kind"] == "position"
        assert d["origin"] == "KSEA" and d["destination"] == "KBOS"
        assert d["position"]["lat"] == 45.559
        assert d["position"]["lon"] == -88.415

    def test_abs_flightinfo_without_position_is_route_only(self):
        d = decoder.decode_message("H1", "#DFBABS026BA_C  AX ,B7378MAX ,260901,WS391 ,CYYZ,CYWG,0484")
        assert d is None or d["kind"] == "progress"
