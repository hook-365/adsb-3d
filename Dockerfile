# =============================================================================
# Stage 1: build the redesigned TypeScript frontend
# =============================================================================
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend

# Install deps first for layer caching
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund

# Copy the rest of the frontend source and build
COPY frontend/ ./
RUN npm run build

# =============================================================================
# Stage 2: runtime nginx image
# =============================================================================
FROM nginx:alpine

# Tools used by entrypoint.sh: bc (math for tile pre-cache), wget (downloads),
# jq (FEEDS_CONFIG parsing), gettext (envsubst), curl (healthcheck).
RUN apk add --no-cache bc wget jq gettext curl

# nginx tile cache dir and tle cache dir removed (satellite dropped)
RUN mkdir -p /var/cache/nginx/tiles

# Built frontend
COPY --from=frontend-build /app/frontend/dist/ /usr/share/nginx/html/

# Tests directory
COPY tests/ /usr/share/nginx/html/tests/

# nginx configurations
COPY nginx/http.conf /etc/nginx/conf.d/00-http.conf
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf

# Entrypoint generates config.js + dynamic feed proxy blocks at startup
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Healthcheck script: verify nginx is up AND the aircraft data pipe returns JSON.
# An empty aircraft list ({"aircraft":[]}) still counts as healthy — there may
# be no planes overhead at night.
COPY docker-healthcheck.sh /docker-healthcheck.sh
RUN chmod +x /docker-healthcheck.sh

# Non-root note: nginx master must run as root to bind port 80. Worker processes
# automatically drop to the `nginx` user (uid 101) via the `user nginx;` directive
# in the default config. File ownership is set accordingly.
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx/tiles \
    && chown nginx:nginx /entrypoint.sh /docker-healthcheck.sh

EXPOSE 80

# interval=30s: check every 30 seconds
# timeout=10s: allow curl up to 10 seconds
# start-period=60s: give the container 60 seconds to start before counting failures
# retries=3: 3 consecutive failures = unhealthy
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD /docker-healthcheck.sh

ENTRYPOINT ["/entrypoint.sh"]
