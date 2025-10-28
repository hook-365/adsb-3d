FROM python:3.11-slim

WORKDIR /app

# Install build dependencies for Python packages with C extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libc6-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Remove build dependencies to reduce image size
RUN apt-get purge -y --auto-remove gcc libc6-dev

# Copy application
COPY main.py .

# Run FastAPI server (which starts collector as background task)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
