FROM python:3.11-slim

WORKDIR /app

# Install build deps, compile Python packages, then purge build tools — all in
# one RUN layer so the compiler never appears in the final image history.
COPY requirements.txt .
RUN apt-get update && apt-get install -y --no-install-recommends gcc g++ make libc6-dev \
    && pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y gcc g++ make libc6-dev && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Copy application
COPY main.py .

# Non-root user for container security
RUN useradd -r -u 10001 appuser && chown -R appuser /app
USER appuser

# Healthcheck — uses python urllib so curl needn't be installed in slim image.
# 30s interval, 15s start-period to allow DB init on first boot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request, sys; r = urllib.request.urlopen('http://localhost:8000/health', timeout=4); sys.exit(0 if r.status == 200 else 1)"

# Run FastAPI server (which starts collector as background task)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
