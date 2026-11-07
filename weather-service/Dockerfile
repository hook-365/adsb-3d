FROM python:3.11.13-slim

WORKDIR /app

# numpy and Pillow ship wheels, so no compiler is needed in the image.
COPY weather-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Build context is the REPOSITORY ROOT (docker build -f weather-service/Dockerfile .)
# so the shared VERSION file is available. Non-release builds append
# "+<build>" (git sha) so a running container can be traced to a commit.
ARG ADSB3D_BUILD=
COPY VERSION .
RUN if [ -n "$ADSB3D_BUILD" ]; then printf '%s+%s\n' "$(tr -d '[:space:]' < VERSION)" "$ADSB3D_BUILD" > VERSION; fi

COPY weather-service/main.py weather-service/mrms.py ./

RUN useradd -r -u 10001 appuser && chown -R appuser /app
USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request, sys; r = urllib.request.urlopen('http://localhost:8000/health', timeout=4); sys.exit(0 if r.status == 200 else 1)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
