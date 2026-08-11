from fastapi.testclient import TestClient

import main

# Instantiated without `with ... as client:` so the FastAPI startup event
# (which opens a real DB pool) never fires — /labels touches no service
# state, so a plain TestClient is sufficient.
client = TestClient(main.app)


class TestLabelsEndpoint:
    def test_returns_a_dict_of_non_empty_strings(self):
        resp = client.get('/labels')
        assert resp.status_code == 200
        body = resp.json()
        labels = body['labels']
        assert isinstance(labels, dict)
        assert len(labels) > 0
        for key, value in labels.items():
            assert isinstance(key, str) and len(key) > 0
            assert isinstance(value, str) and len(value) > 0

    def test_spot_check_known_labels(self):
        resp = client.get('/labels')
        labels = resp.json()['labels']
        assert labels['Q0'] == 'OOOI (Out, Off, On, In)'
        assert labels['22'] == 'METAR/TAF'
