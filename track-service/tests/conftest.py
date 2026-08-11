import os
import sys

# main.py imports at module scope with no external I/O (DB pool creation is
# deferred to the FastAPI startup event), so plain `import main` is safe
# without a database or feeder present. Insert the service root ahead of
# anything else on sys.path so `import main` resolves to *this* service's
# main.py, not acars-service's module of the same name.
SERVICE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SERVICE_ROOT not in sys.path:
    sys.path.insert(0, SERVICE_ROOT)

import pytest

import main  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_route_cache_globals():
    """Snapshot and restore the route-cache module globals around every
    test so route-cache/circuit-breaker tests don't leak state into each
    other or into unrelated tests that happen to import `main`."""
    saved_cache = dict(main.route_cache)
    saved_failures = main._route_circuit_failures
    saved_open_until = main._route_circuit_open_until
    saved_cache_max = main.ROUTE_CACHE_MAX
    try:
        yield
    finally:
        main.route_cache.clear()
        main.route_cache.update(saved_cache)
        main._route_circuit_failures = saved_failures
        main._route_circuit_open_until = saved_open_until
        main.ROUTE_CACHE_MAX = saved_cache_max
