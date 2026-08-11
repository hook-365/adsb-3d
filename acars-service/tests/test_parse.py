from datetime import datetime, timezone

import main


def make_collector() -> main.ACARSCollector:
    # __init__ only reads env vars and initializes local state — no I/O —
    # so constructing with db_pool=None is safe for unit-testing the parser.
    return main.ACARSCollector(db_pool=None)


class TestParseAcarsMessageFieldMapping:
    def test_full_field_mapping_from_acarshub_style_dict(self):
        c = make_collector()
        data = {
            'flight': 'UAL123',
            'tail': 'N12345',
            'icao': 'A1B2C3',
            'label': 'H1',
            'block_id': '1',
            'msg_num': 'M01A',
            'text': 'HELLO WORLD',
            'freq': '131.550',
            'level': '5',
            'error': '0',
            'mode': '2',
            'dsta': 'KORD',
            'eta': '1200',
            'gtout': '1100',
            'gtin': '1300',
            'wloff': '1115',
            'wlin': '1245',
            'lat': '41.9786',
            'lon': '-87.9048',
            'alt': '35000',
        }
        parsed = c.parse_acars_message(data)
        assert parsed is not None
        assert parsed['flight'] == 'UAL123'
        assert parsed['reg'] == 'N12345'
        assert parsed['icao'] == 'A1B2C3'
        assert parsed['label'] == 'H1'
        assert parsed['block_id'] == '1'
        assert parsed['msg_num'] == 'M01A'
        assert parsed['text'] == 'HELLO WORLD'
        assert parsed['freq'] == 131.550
        assert parsed['level'] == 5
        assert parsed['error'] == 0
        assert parsed['mode'] == '2'
        assert parsed['dsta'] == 'KORD'
        assert parsed['eta'] == '1200'
        assert parsed['gtout'] == '1100'
        assert parsed['gtin'] == '1300'
        assert parsed['wloff'] == '1115'
        assert parsed['wlin'] == '1245'
        assert parsed['lat'] == 41.9786
        assert parsed['lon'] == -87.9048
        assert parsed['alt'] == 35000
        assert parsed['station_id'] == c.station_id
        assert isinstance(parsed['time'], datetime)
        assert parsed['time'].tzinfo == timezone.utc

    def test_tail_preferred_over_reg_key(self):
        c = make_collector()
        parsed = c.parse_acars_message({'tail': 'N1', 'reg': 'N2'})
        assert parsed['reg'] == 'N1'

    def test_reg_key_fallback_when_tail_absent(self):
        c = make_collector()
        parsed = c.parse_acars_message({'reg': 'N2'})
        assert parsed['reg'] == 'N2'

    def test_msgno_alt_key_for_msg_num(self):
        c = make_collector()
        parsed = c.parse_acars_message({'msgno': 'M99Z'})
        assert parsed['msg_num'] == 'M99Z'

    def test_message_alt_key_for_text(self):
        c = make_collector()
        parsed = c.parse_acars_message({'message': 'ALT TEXT'})
        assert parsed['text'] == 'ALT TEXT'

    def test_signal_alt_key_for_level(self):
        c = make_collector()
        parsed = c.parse_acars_message({'signal': '9'})
        assert parsed['level'] == 9

    def test_mode_defaults_to_acars(self):
        c = make_collector()
        parsed = c.parse_acars_message({})
        assert parsed['mode'] == 'ACARS'


class TestFlightWhitespaceHandling:
    def test_whitespace_only_flight_becomes_none(self):
        c = make_collector()
        parsed = c.parse_acars_message({'flight': '   '})
        assert parsed['flight'] is None

    def test_null_flight_becomes_none(self):
        c = make_collector()
        parsed = c.parse_acars_message({'flight': None})
        assert parsed['flight'] is None

    def test_missing_flight_becomes_none(self):
        c = make_collector()
        parsed = c.parse_acars_message({})
        assert parsed['flight'] is None

    def test_flight_is_stripped(self):
        c = make_collector()
        parsed = c.parse_acars_message({'flight': '  UAL123  '})
        assert parsed['flight'] == 'UAL123'


class TestCoercion:
    def test_to_int_from_string(self):
        assert main.ACARSCollector._to_int('42') == 42

    def test_to_int_from_none(self):
        assert main.ACARSCollector._to_int(None) is None

    def test_to_int_from_garbage_returns_none(self):
        assert main.ACARSCollector._to_int('not-a-number') is None

    def test_to_float_from_string(self):
        assert main.ACARSCollector._to_float('131.55') == 131.55

    def test_to_float_from_none(self):
        assert main.ACARSCollector._to_float(None) is None

    def test_to_float_from_garbage_returns_none(self):
        assert main.ACARSCollector._to_float('nope') is None

    def test_to_text_from_numeric(self):
        assert main.ACARSCollector._to_text(42) == '42'

    def test_to_text_from_falsy_returns_none(self):
        assert main.ACARSCollector._to_text('') is None
        assert main.ACARSCollector._to_text(0) is None
        assert main.ACARSCollector._to_text(None) is None

    def test_string_freq_coerces_to_float_in_parse(self):
        c = make_collector()
        parsed = c.parse_acars_message({'freq': '136.900'})
        assert parsed['freq'] == 136.9
        assert isinstance(parsed['freq'], float)

    def test_string_level_coerces_to_int_in_parse(self):
        c = make_collector()
        parsed = c.parse_acars_message({'level': '3'})
        assert parsed['level'] == 3
        assert isinstance(parsed['level'], int)

    def test_numeric_text_fields_coerce_to_str_in_parse(self):
        c = make_collector()
        parsed = c.parse_acars_message({'label': 12, 'block_id': 3})
        assert parsed['label'] == '12'
        assert parsed['block_id'] == '3'
