# =============================================================================
# Stage 1: build the redesigned TypeScript frontend
# =============================================================================
FROM node:20.19-alpine AS frontend-build
WORKDIR /app/frontend

# Install deps first for layer caching
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy the rest of the frontend source and build
COPY frontend/ ./
RUN npm run build

# =============================================================================
# Stage 2: runtime nginx image
# =============================================================================
FROM nginx:1.29-alpine

# Tools used by entrypoint.sh: bc (math for tile pre-cache), wget (downloads),
# jq (FEEDS_CONFIG parsing), gettext (envsubst), curl (healthcheck).
# Versions intentionally unpinned: Alpine's apk repos drop superseded package
# versions once a new one lands, so pinning here breaks rebuilds within days.
RUN apk add --no-cache bc wget jq gettext curl

# nginx tile cache dir and tle cache dir removed (satellite dropped)
RUN mkdir -p /var/cache/nginx/tiles

# Built frontend
COPY --from=frontend-build /app/frontend/dist/ /usr/share/nginx/html/

# nginx configurations. nginx.conf is a template: entrypoint.sh renders it
# fresh (envsubst + dynamic feed blocks) into conf.d/default.conf on every
# boot, so it lives under templates/ as a pristine source — never edited or
# consumed in place. (Our entrypoint fully replaces nginx's own docker
# entrypoint, so nginx's built-in templates/ auto-render never runs; this
# is just a conventional home for a template file.)
COPY nginx/http.conf /etc/nginx/conf.d/00-http.conf
COPY nginx/nginx.conf /etc/nginx/templates/default.conf.template

# Entrypoint generates config.js + dynamic feed proxy blocks at startup
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Healthcheck script: nginx is up and entrypoint.sh's rendered config.js is
# present. Deliberately does NOT probe feeder freshness — that's surfaced
# in-app via feeder_age_s on WS frames, not container health, so a feeder
# reboot can't make an orchestrator restart an otherwise-healthy viewer.
COPY docker-healthcheck.sh /docker-healthcheck.sh
RUN chmod +x /docker-healthcheck.sh

# Non-root note: nginx master must run as root to bind port 80. Worker processes
# automatically drop to the `nginx` user (uid 101) via the `user nginx;` directive
# in the default config. Workers only READ the webroot, so it stays root-owned
# (world-readable) — a compromised worker must not be able to rewrite served JS
# or the root-executed entrypoint. Only the proxy cache needs worker writes.
RUN chown -R nginx:nginx /var/cache/nginx/tiles

EXPOSE 80

# interval=30s: check every 30 seconds
# timeout=10s: allow curl up to 10 seconds
# start-period=60s: give the container 60 seconds to start before counting failures
# retries=3: 3 consecutive failures = unhealthy
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD /docker-healthcheck.sh

ENTRYPOINT ["/entrypoint.sh"]
