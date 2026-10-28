FROM python:3.11.13-slim

WORKDIR /app

# Install build tools (needed for asyncpg, aiohttp, etc. on ARM), then clean up
COPY track-service/requirements.txt .
RUN apt-get update && apt-get install -y --no-install-recommends gcc g++ make libc6-dev \
    && pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y gcc g++ make libc6-dev && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Copy application. Build context is the REPOSITORY ROOT (see
# .github/workflows/docker-publish.yml and docker-compose.example.yml:
# `context: .` + `dockerfile: track-service/Dockerfile`) so the shared VERSION
# file is available. ADSB3D_BUILD appends build metadata for non-release
# builds, same convention as the viewer image.
ARG ADSB3D_BUILD=
COPY VERSION .
RUN if [ -n "$ADSB3D_BUILD" ]; then printf '%s+%s\n' "$(tr -d '[:space:]' < VERSION)" "$ADSB3D_BUILD" > VERSION; fi
COPY track-service/main.py .

# Non-root user for container security
RUN useradd -r -u 10001 appuser && chown -R appuser /app
USER appuser

# Healthcheck — uses python urllib so curl needn't be installed in slim image.
# 30s interval, 15s start-period to allow DB init on first boot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request, sys; r = urllib.request.urlopen('http://localhost:8000/health', timeout=4); sys.exit(0 if r.status == 200 else 1)"

# Run FastAPI server (which starts collector as background task).
# --ws-per-message-deflate compresses WebSocket frames; snapshot bursts
# shrink ~5x and per-tick diff frames ~2x.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--ws-per-message-deflate", "true"]
