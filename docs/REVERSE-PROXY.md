# Reverse Proxy Configuration Guide

This guide shows how to deploy ADS-B 3D behind various reverse proxies.

## Table of Contents
- [Nginx](#nginx)
- [Traefik](#traefik)
- [Caddy](#caddy)
- [Apache](#apache)
- [NPM Plus](#npm-plus-nginx-proxy-manager)

---

## Nginx

### Scenario 1: Root Domain (`adsb3d.example.com`)

```nginx
server {
    listen 443 ssl http2;
    server_name adsb3d.example.com;

    # SSL configuration (adjust paths as needed)
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://adsb-3d:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (if needed in future)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Health check endpoint
    location /health {
        proxy_pass http://adsb-3d:80/health;
        access_log off;
    }
}
```

**docker-compose.yml:**
```yaml
environment:
  # No BASE_PATH needed - auto-detects as root
  - LATITUDE=your_lat
  - LONGITUDE=your_lon
  - ALTITUDE=your_alt
  - FEEDER_URL=http://ultrafeeder
```

---

### Scenario 2: Subdirectory (`example.com/3d`)

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    # SSL configuration
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /3d {
        proxy_pass http://adsb-3d:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Health check
    location /3d/health {
        proxy_pass http://adsb-3d:80/health;
        access_log off;
    }
}
```

**docker-compose.yml:**
```yaml
environment:
  # No BASE_PATH needed - auto-detects /3d
  - LATITUDE=your_lat
  - LONGITUDE=your_lon
  - ALTITUDE=your_alt
  - FEEDER_URL=http://ultrafeeder
```

---

### Scenario 3: Custom Subdirectory (`example.com/mypath`)

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    location /mypath {
        proxy_pass http://adsb-3d:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**docker-compose.yml:**
```yaml
environment:
  - BASE_PATH=/mypath  # Explicitly set for custom path
  - LATITUDE=your_lat
  - LONGITUDE=your_lon
  - ALTITUDE=your_alt
  - FEEDER_URL=http://ultrafeeder
```

---

## Traefik

### docker-compose.yml with Traefik Labels

```yaml
services:
  adsb-3d:
    image: ghcr.io/username/adsb-3d:latest
    container_name: adsb-3d
    restart: unless-stopped

    environment:
      - LATITUDE=44.9104
      - LONGITUDE=-89.5551
      - ALTITUDE=1234
      - FEEDER_URL=http://ultrafeeder
      # No BASE_PATH needed for auto-detection

    labels:
      # Enable Traefik
      - "traefik.enable=true"

      # Router for HTTPS
      - "traefik.http.routers.adsb-3d.rule=Host(`adsb3d.example.com`)"
      - "traefik.http.routers.adsb-3d.entrypoints=websecure"
      - "traefik.http.routers.adsb-3d.tls=true"
      - "traefik.http.routers.adsb-3d.tls.certresolver=letsencrypt"

      # Service
      - "traefik.http.services.adsb-3d.loadbalancer.server.port=80"

      # Health check
      - "traefik.http.services.adsb-3d.loadbalancer.healthcheck.path=/health"
      - "traefik.http.services.adsb-3d.loadbalancer.healthcheck.interval=30s"

    networks:
      - traefik

networks:
  traefik:
    external: true
```

### Traefik Subdirectory Deployment

```yaml
labels:
  # Subdirectory: example.com/3d
  - "traefik.http.routers.adsb-3d.rule=Host(`example.com`) && PathPrefix(`/3d`)"
  - "traefik.http.middlewares.adsb-3d-stripprefix.stripprefix.prefixes=/3d"
  - "traefik.http.routers.adsb-3d.middlewares=adsb-3d-stripprefix"
```

**Note**: For subdirectory with Traefik, you may need to set `BASE_PATH=/3d` depending on your stripprefix configuration.

---

## Caddy

### Caddyfile - Root Domain

```caddy
adsb3d.example.com {
    reverse_proxy adsb-3d:80

    # Health check
    handle /health {
        reverse_proxy adsb-3d:80
    }
}
```

### Caddyfile - Subdirectory

```caddy
example.com {
    handle_path /3d* {
        reverse_proxy adsb-3d:80
    }

    handle /3d/health {
        reverse_proxy adsb-3d:80
    }
}
```

**docker-compose.yml** for Caddy:
```yaml
environment:
  # Auto-detection works for /3d
  - LATITUDE=your_lat
  - LONGITUDE=your_lon
  - ALTITUDE=your_alt
  - FEEDER_URL=http://ultrafeeder
```

---

## Apache

### Apache VirtualHost - Root Domain

```apache
<VirtualHost *:443>
    ServerName adsb3d.example.com

    SSLEngine on
    SSLCertificateFile /path/to/cert.pem
    SSLCertificateKeyFile /path/to/key.pem

    ProxyPreserveHost On
    ProxyPass / http://adsb-3d:80/
    ProxyPassReverse / http://adsb-3d:80/

    # Health check
    <Location /health>
        ProxyPass http://adsb-3d:80/health
    </Location>
</VirtualHost>
```

### Apache VirtualHost - Subdirectory

```apache
<VirtualHost *:443>
    ServerName example.com

    SSLEngine on
    SSLCertificateFile /path/to/cert.pem
    SSLCertificateKeyFile /path/to/key.pem

    ProxyPreserveHost On

    <Location /3d>
        ProxyPass http://adsb-3d:80/
        ProxyPassReverse http://adsb-3d:80/
    </Location>

    <Location /3d/health>
        ProxyPass http://adsb-3d:80/health
    </Location>
</VirtualHost>
```

**Required Apache modules:**
```bash
a2enmod proxy proxy_http ssl headers
systemctl restart apache2
```

---

## NPM Plus (Nginx Proxy Manager)

### GUI Configuration

1. **Proxy Hosts** → **Add Proxy Host**

2. **Details Tab:**
   - **Domain Names**: `adsb3d.example.com`
   - **Scheme**: `http`
   - **Forward Hostname / IP**: `adsb-3d` (container name)
   - **Forward Port**: `80`
   - **Cache Assets**: ✅ Enabled
   - **Block Common Exploits**: ✅ Enabled
   - **Websockets Support**: ✅ Enabled

3. **SSL Tab:**
   - **SSL Certificate**: Select or create Let's Encrypt certificate
   - **Force SSL**: ✅ Enabled
   - **HTTP/2 Support**: ✅ Enabled
   - **HSTS Enabled**: ✅ Enabled

4. **Advanced Tab (optional):**
   ```nginx
   # Health check endpoint
   location /health {
       proxy_pass http://adsb-3d:80/health;
       access_log off;
   }
   ```

### NPM Plus - Subdirectory Deployment

1. **Domain Names**: `example.com`
2. **Custom locations:**
   - **Path**: `/3d`
   - **Forward Hostname**: `adsb-3d`
   - **Forward Port**: `80`

---

## Common Issues & Solutions

### Issue: Assets not loading (404 errors)

**Cause**: BASE_PATH misconfiguration

**Solution**:
1. Check browser console for 404 errors
2. If paths are incorrect, set `BASE_PATH` explicitly
3. Restart container after changing environment variables

---

### Issue: WebSocket connection fails

**Symptom**: Historical mode doesn't work, API calls fail

**Solution**: Ensure WebSocket headers are configured:
```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

---

### Issue: Mixed content warnings (HTTPS → HTTP)

**Cause**: Reverse proxy not passing `X-Forwarded-Proto`

**Solution**: Add header:
```nginx
proxy_set_header X-Forwarded-Proto $scheme;
```

---

### Issue: Health check returns 502

**Cause**: Container not fully started yet

**Solution**:
- Wait 10-15 seconds after container start
- Check: `docker logs adsb-3d`
- Test: `curl http://localhost:8086/health`

---

## Testing Your Configuration

### 1. Test Health Endpoint
```bash
curl https://adsb3d.example.com/health
# Expected: OK
```

### 2. Test Main Page
```bash
curl -I https://adsb3d.example.com/
# Expected: HTTP/2 200
```

### 3. Test in Browser
1. Open https://adsb3d.example.com
2. Check browser console (F12) for errors
3. Verify aircraft appear on the 3D map
4. Check theme switching works
5. Test mobile responsive layout

---

## Security Recommendations

### Rate Limiting (Nginx)
```nginx
# In http block
limit_req_zone $binary_remote_addr zone=adsb3d_limit:10m rate=10r/s;

# In location block
limit_req zone=adsb3d_limit burst=20 nodelay;
```

### IP Whitelisting (for private deployments)
```nginx
location / {
    allow 192.168.1.0/24;  # Your local network
    allow 10.0.0.0/8;       # VPN network
    deny all;

    proxy_pass http://adsb-3d:80;
}
```

### Headers Security
```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "no-referrer-when-downgrade" always;
```

---

## Need Help?

- Check container logs: `docker logs adsb-3d`
- Test health endpoint: `curl http://container-ip/health`
- Verify feeder connectivity: `curl http://feeder/data/aircraft.json`
- Check browser console for JavaScript errors
- Review nginx/traefik/caddy logs for proxy errors
