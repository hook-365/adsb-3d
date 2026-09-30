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
