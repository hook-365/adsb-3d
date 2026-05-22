# ACARS Service

Collects ACARS (Aircraft Communications Addressing and Reporting System) messages from an ACARS Hub instance and provides a REST API for integration with adsb-3d.

## Overview

This service:
1. Connects to ACARS Hub TCP port (15550) on your RPi running adsb.im
2. Receives JSON-formatted ACARS messages
3. Stores messages in TimescaleDB (same database as track-service)
4. Provides REST API endpoints for querying messages

## Prerequisites

- RPi running [adsb.im](https://adsb.im) feeder image with ACARS enabled
- An external acarshub stack with ACARS decoding (RTL-SDR, Airspy, or other supported SDR)
- TimescaleDB running (part of `historical` profile)

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ACARS_HOST` | `acarshub` | Hostname or IP of the ACARS Hub instance |
| `ACARS_PORT` | `15550` | TCP port for ACARS JSON output |
| `STATION_ID` | `adsb-3d` | Your station identifier |
| `DB_HOST` | `timescaledb-adsb` | TimescaleDB host |
| `DB_PORT` | `5432` | TimescaleDB port |
| `DB_NAME` | `adsb_tracks` | Database name |
| `DB_USER` | `adsb` | Database user |
| `DB_PASSWORD` | (required) | Database password |

### Enabling ACARS

ACARS requires an **external acarshub stack** running on your network
(typically on the same Raspberry Pi as your ADS-B feeder). The community
[acarshub](https://github.com/sdr-enthusiasts/docker-acarshub) project
exposes a JSON stream on TCP port 15550 by default. `acars-service` connects
to that port, decodes the messages, and stores them in TimescaleDB.

Steps:

1. **Ensure your acarshub stack is running** and reachable over the network.
   Test with:
   ```bash
   nc -zv <acarshub-host> 15550
   ```

2. **Uncomment the `timescaledb` and `acars-service` blocks** in
   `docker-compose.example.yml`. The `acars-service` block uses:
   ```yaml
   image: ghcr.io/hook-365/adsb-acars-service:latest
   ```
   Set `ACARS_HOST` to the hostname or IP of your acarshub instance.

3. **Enable ACARS in the `adsb-3d` service** (add to its `environment:` block):
   ```yaml
   environment:
     - ENABLE_ACARS=true
   ```

4. **Start the services**:
   ```bash
   docker compose up -d
   ```

The `acars-service` will connect to acarshub on startup. If the connection
fails, it retries automatically — the adsb-3d frontend degrades gracefully
and simply hides the ACARS chip.

## API Endpoints

### Health Check
```
GET /health
```
Returns service status, database connection, and collector statistics.
Result is cached for 2 s so frequent Docker health-check probes do not hit the
pool on every call.

Response:
```json
{
  "status": "healthy",
  "database": "connected",
  "collector": "running",
  "stats": {
    "messages_total": 18432,
    "messages_24h": 612,
    "messages_this_session": 204,
    "messages_dropped": 0,
    "last_message": "2024-01-15T14:23:01.123456+00:00"
  }
}
```

### WebSocket Stream
```
WebSocket /ws
```
Real-time ACARS message stream. On connect the server immediately sends a
`{type: "connected", message, clients, hub_connected, last_message_age_s,
messages_received}` frame so the client knows whether data is expected without
waiting for the first heartbeat.

Subsequent frames are one of:

- **`new_message`** — emitted for every decoded ACARS message:
  ```json
  {
    "type": "new_message",
    "message": {
      "time": "2024-01-15T14:23:01+00:00",
      "flight": "UAL432", "reg": "N12345", "icao": "a1b2c3",
      "label": "H1", "block_id": "3", "msg_num": "S12A",
      "text": "...", "freq": 131.55, "level": -4, "error": 0,
      "mode": "ACARS", "station_id": "adsb-3d",
      "destination": "LAX", "eta": "1423",
      "gtout": null, "wloff": null, "wlin": null, "gtin": null,
      "position": {"lat": 37.62, "lon": -122.38, "alt": 35000}
    }
  }
  ```
  `position` is `null` when the message carries no lat/lon.

- **`heartbeat`** — sent every 5 seconds to every connected client:
  ```json
  {
    "type": "heartbeat",
    "hub_connected": true,
    "last_message_age_s": 3.2,
    "messages_received": 204
  }
  ```
  `hub_connected` reflects live TCP connection state to the acarshub feed.
  `last_message_age_s` is seconds since the last decoded message (`null` if
  none yet this session). Clients use these fields to distinguish "service
  alive, hub talking" from "service alive, hub silent".

Inbound messages: the server honours `"ping"` with a `"pong"` text reply for
keepalive; any other inbound text is ignored.

### Recent Messages
```
GET /messages/recent?minutes=30&limit=100&flight=UAL&label=Q0
```
Get recent ACARS messages with optional filters.

### Messages by Flight
```
GET /messages/flight/{flight}?hours=24&limit=50
```
Get all messages for a specific flight number.

### Messages by Aircraft
```
GET /messages/aircraft/{identifier}?hours=24&limit=50
```
Get messages by ICAO hex code or registration.

### Statistics
```
GET /stats?days=7
```
Get message statistics: counts, top flights, hourly distribution.

### Label Descriptions
```
GET /labels
```
Get human-readable descriptions of ACARS label codes.

## ACARS Message Labels

Common label codes you'll see:

| Label | Description |
|-------|-------------|
| `Q0` | OOOI (Out, Off, On, In) report |
| `QA` | ETA report |
| `H1` | Operations message |
| `5U` | Weather request |
| `SA` | Departure clearance |
| `_d` | Free text downlink |

## Database Schema

Messages are stored in the `acars_messages` table:

```sql
CREATE TABLE acars_messages (
    time TIMESTAMPTZ NOT NULL,
    flight TEXT,
    reg TEXT,
    icao TEXT,
    label TEXT,
    block_id TEXT,   -- Block identifier within a multi-block message
    msg_num TEXT,    -- Message sequence number (e.g. "S12A")
    text TEXT,
    freq REAL,
    level INTEGER,
    error INTEGER,   -- Bit-error count reported by the decoder
    mode TEXT DEFAULT 'ACARS',
    station_id TEXT, -- Receiving station identifier
    -- OOOI fields
    dsta TEXT,       -- Destination
    eta TEXT,        -- ETA
    gtout TEXT,      -- Gate out
    gtin TEXT,       -- Gate in
    wloff TEXT,      -- Wheels off
    wlin TEXT,       -- Wheels on
    -- Position (if available)
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    alt INTEGER
);
```

- **Hypertable**: 7-day chunks for efficient time-series queries
- **Compression**: Enabled after 7 days (70-80% storage savings)
- **Retention**: 30 days (hardcoded)

## Troubleshooting

### No messages received
1. Check the acarshub TCP JSON feed is reachable on port 15550 (not port 8080,
   which is the acarshub web UI): `nc -zv <acarshub-host> 15550`
2. If you also want to verify acarshub itself is running, open its web UI at
   `http://<acarshub-host>:8080` in a browser.
3. Check collector logs: `docker compose logs -f acars-service`

### Connection refused
- Ensure ACARS Hub exposes TCP port 15550 (not just UDP)
- Check firewall rules on RPi

### Database errors
- Ensure the `timescaledb` block is uncommented in `docker-compose.example.yml`
  and the service is running: `docker compose up -d timescaledb-adsb`
- Check database connectivity

## Integration with adsb-3d

When ACARS is enabled (`ENABLE_ACARS=true`), adsb-3d will:
1. Check `/acars-api/health` on startup
2. If available, show ACARS status in info panel
3. Allow querying messages for selected aircraft
4. Display message counts and recent activity

The frontend integration is handled through the nginx proxy which routes `/acars-api/*` to this service.
