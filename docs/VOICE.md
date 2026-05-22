# Voice Scanner (VHF AM aviation voice)

An optional companion stack that records local airband voice traffic on a
small set of VHF frequencies and surfaces it in the ADS-B 3D viewer as a
**call feed** — every radio transmission becomes a discrete, channel-tagged
audio clip, the way OpenMHz and Broadcastify Calls present radio traffic.

```
Airspy SDR ──USB── rtl_airband ──per-transmission MP3──► recordings dir
  (SDR host)           │                                  (NFS-shared)
                       │ mixer ──► Icecast (legacy stream, optional)
                                                          │
                          voice-events sidecar ◄──────────┘
                            (server host)        reads recordings dir
                              ├─ indexes each new clip
                              ├─ GET /calls            (JSON, newest-first)
                              ├─ GET /calls/<id>/audio (Range-capable MP3)
                              └─ WS  /ws               (new-call + activity push)
                                       │
                                       ▼
                            adsb-3d nginx  ──►  browser
                            (/voice/calls, /voice/ws)
                               Voice panel: call feed,
                               scanner mode, activity strip
```

This is **opt-in**. The frontend gates the panel on `ENABLE_VOICE=true` in the
adsb-3d container env; with it off, no UI, no proxies, no calls.

## Why a call feed, not a live stream

An earlier design streamed one mixed MP3 (all channels) from Icecast and lit
per-channel activity dots from a separate WebSocket. Icecast plus browser
buffering delays the audio several seconds; the dots are not delayed. They
never line up.

The call-based model removes the problem by construction: each clip is one
transmission on one channel, so the channel shown is metadata of the exact
audio being heard. There is nothing to sync. The trade-off is an inherent
few-second delay — a call cannot play until the transmission ends, the file
closes, and the indexer picks it up. That is how OpenMHz / Broadcastify Calls
behave, and it is the right trade for accuracy.

## How the panel behaves

When `ENABLE_VOICE=true`, the viewer renders a Voice panel in the top-right:

- **Call feed** — a scrolling list of recent transmissions (time, channel,
  frequency, duration). The web view keeps the **last hour**; the indexer
  retains more on the backend.
- **Scanner mode** (`▶`) — "watch for the drop": arming the scanner does *not*
  replay history; it waits for the *next* transmission and auto-plays calls as
  they land, advancing through any that queue up while one is playing.
- **Live activity strip** — one chip per channel; a chip lights when that
  channel transmits and holds briefly so short bursts stay visible.
- **Click-to-replay** — any past call in the list plays on click; the scanner
  resumes afterward.
- **Collapsed chip** — when minimised, the 📻 chip shows a green dot while the
  scanner is listening, pings on each transmission, and labels the playing
  channel + frequency.
- **Local-feed-only** — in multi-feed deployments the panel is mounted **only**
  on the local feed. Switching to a remote feed destroys it (no UI, no
  WebSocket activity, no audio), so the viewer never implies ATC coverage at a
  site you don't actually receive.

## Requirements

- A supported SDR reachable over USB on the host that will run `rtl_airband`.
  The image is built with `SOAPYSDR=ON`, so any SoapySDR-compatible device
  works (Airspy R2/Mini/HF+, RTL-SDR, HackRF, etc.).
- **Docker + Docker Compose** on both:
  - the **SDR host** (the one with the Airspy plugged in)
  - the **server host** (anywhere on the LAN — can be the same machine)
- One open port on the server host:
  - `8001/tcp` — voice-events sidecar (call index + WebSocket; this is the
    only host the viewer talks to)
  - `8000/tcp` — Icecast, *only* if you keep the legacy mixed stream (the
    call-based frontend never connects to it — see [Icecast](#icecast-legacy))
- A pair of hostnames that resolve between the adsb-3d container and the voice
  stack. The simplest setup uses a shared external Docker network so both can
  address each other by container name (e.g. `voice-events:8001`).

There is **no antenna assumption** beyond "whatever you already use for VHF
airband." A discone + LNA in the attic is plenty; a purpose-cut dipole is
better.

## Two halves of the stack

### A. Server host — voice-events sidecar

One small container you build yourself — it watches the recordings
directory, indexes each completed transmission into a rolling in-memory
index, and serves the call API + WebSocket. The compose and service
sketches below are a starting point; adapt them to your setup.

`docker-compose.yml`:
```yaml
services:
  voice-events:
    build: ./events
    container_name: voice-events
    restart: unless-stopped
    ports:
      - "8001:8001"
    environment:
      - STATS_PATH=/recordings/stats.txt   # rtl_airband stats file (activity)
      - POLL_INTERVAL_S=1.0                # recordings + stats poll cadence
      - ACTIVE_DECAY_S=2.0                 # activity-dot hold after a burst
      - RETENTION_HOURS=48                 # delete clips off disk after this
      - RETENTION_SWEEP_S=1800             # disk-cleanup sweep interval
    volumes:
      # Mounted :rw so the retention sweep can delete expired clips.
      - /transient/airband/recordings:/recordings:rw
    networks: [voice_net, seg_monitoring]

networks:
  voice_net:
    driver: bridge
  seg_monitoring:
    external: true
```

`events/` is a small `aiohttp` + asyncio service. It:

- polls the recordings tree for newly-completed clips (poll, not inotify —
  the tree is NFS-written; a clip is "done" once its mtime is stable);
- derives a `Call` per file and keeps a rolling in-memory index;
- tails the rtl_airband stats file for live per-channel activity;
- runs a background retention sweep that deletes expired `.mp3` files and
  prunes empty date directories.

It is a small standalone service — `aiohttp` plus an `asyncio` poll loop;
the endpoint contract below is everything it needs to implement.

### B. SDR host — rtl_airband

One container, USB passthrough, NFS-mounting the server host's recordings
directory so the per-transmission MP3s land where the sidecar can index them.

`docker-compose.yml`:
```yaml
services:
  rtl_airband:
    build: .
    container_name: voice-rtl-airband
    restart: unless-stopped
    network_mode: host
    privileged: true
    environment:
      - ICECAST_SOURCE_PASSWORD=${ICECAST_SOURCE_PASSWORD:?set in .env}
      - ICECAST_HOST=${ICECAST_HOST:-192.0.2.10}
      - ICECAST_PORT=${ICECAST_PORT:-8000}
    volumes:
      - /dev/bus/usb:/dev/bus/usb
      - /opt/voice-services/rtl_airband.conf.tmpl:/etc/rtl_airband.conf.tmpl:ro
      - /mnt/airband-recordings:/recordings   # NFS mount; see below
```

The Dockerfile is multi-stage: it builds rtl_airband from upstream
(`charlie-foxtrot/RTLSDR-Airband`) with `SOAPYSDR=ON`, installs
`soapysdr-module-airspy` in the runtime image, and renders a config template
at start. Bind-mounting the config template (as above) lets you tune
frequencies and squelch without rebuilding the image.

**Per-transmission recording is the key setting.** Each channel's `file`
output must use:

```
file {
  directory = "/recordings/kcwa-twr";
  filename_template = "kcwa-twr";
  split_on_transmission = true;   // one MP3 per keyup — the call feed
  continuous = false;             // don't pad silence between transmissions
  dated_subdirectories = true;    // .../YYYY/MM/DD/ tree
}
```

That produces one file per transmission, timestamped to the second
(`kcwa-twr/2026/05/21/kcwa-twr_20260521_143052.mp3`). The optional `mixer`
output (feeding Icecast) can stay or go — see [Icecast](#icecast-legacy).

Tune squelch **hangtime** so a mid-sentence pause is not chopped into several
files. Too short and one transmission becomes three clips; too long and two
back-to-back transmissions merge.

**Critical build flags for a Raspberry Pi 3:**
- `PLATFORM=native` (enables NEON SIMD; without it the Pi 3 saturates CPU at
  6 MSPS)
- `fft_size = 1024` (4096 also saturates the Pi 3; 1024 fits within budget
  with zero buffer overflows)

**NFS mount setup** (server host exports, SDR host mounts):
```
# Server host /etc/exports
/transient/airband/recordings 192.0.2.24(rw,sync,no_subtree_check,no_root_squash)

# SDR host /etc/fstab
192.0.2.10:/transient/airband/recordings  /mnt/airband-recordings  nfs  defaults,_netdev  0 0
```

Both addresses are TEST-NET placeholders — substitute your LAN. The
recordings physically live on the server host, so the voice-events sidecar
reads them from local disk while rtl_airband writes them over NFS.

## Wiring it into ADS-B 3D

Once both halves are running, the viewer side is three compose env vars:

```yaml
- ENABLE_VOICE=true
- VOICE_EVENTS_HOST=voice-events:8001   # the sidecar — what the frontend uses
- VOICE_STREAM_HOST=voice-icecast:8000  # legacy Icecast block (see below)
```

`entrypoint.sh` substitutes these into `nginx.conf`, which proxies:

| Browser path            | Upstream                            | Used by frontend |
|-------------------------|-------------------------------------|------------------|
| `/voice/calls`          | `${VOICE_EVENTS_HOST}/calls`        | yes — call index |
| `/voice/calls/<id>/audio` | `${VOICE_EVENTS_HOST}/calls/...`  | yes — clip audio |
| `/voice/ws`             | `${VOICE_EVENTS_HOST}/ws`           | yes — call/activity push |
| `/voice/scanner.mp3`    | `${VOICE_STREAM_HOST}/scanner.mp3`  | no — legacy stream |

`ENABLE_VOICE=true` **requires both** `VOICE_EVENTS_HOST` and
`VOICE_STREAM_HOST` — the container refuses to start otherwise, with a clear
error, rather than generating an invalid nginx config. The frontend only ever
talks to its own origin, so the browser never needs direct LAN access to the
upstream hosts; NPMPlus or any other reverse proxy in front of adsb-3d works
for the voice panel too.

## Icecast (legacy)

The call-based frontend does **not** play the Icecast mixed stream. Icecast
is retained only for compatibility: the `/voice/scanner.mp3` nginx block must
have a syntactically valid upstream, which is why `VOICE_STREAM_HOST` is still
required.

You have two options:

- **Keep Icecast.** Leave the rtl_airband `mixer` output in place and run an
  Icecast container; point `VOICE_STREAM_HOST` at it. The `/voice/scanner.mp3`
  route then works for anything that wants the raw mixed stream directly,
  even though the viewer's panel does not use it.
- **Drop Icecast.** Remove the `mixer` output from `rtl_airband.conf`, don't
  run an Icecast container, and point `VOICE_STREAM_HOST` at any reachable
  `host:port` (it will simply never be queried). The call feed is unaffected.

A minimal Icecast container is a 10-line Alpine + `apk add icecast` image
whose entrypoint renders `icecast.xml` with source/admin/relay passwords
substituted from a gitignored `.env`.

## The voice-events sidecar

### Endpoints

| Endpoint                       | Purpose                                            |
|--------------------------------|----------------------------------------------------|
| `GET /calls?since=&limit=&channel=` | Recent calls as JSON, newest-first.           |
| `GET /calls/<id>/audio`        | The clip's MP3. Range-capable so `<audio>` can seek. |
| `WS /ws` (also `/voice/ws`)    | Pushes `{type:'call',call}` on each new transmission and `{type:'activity',channels}` snapshots. |
| `GET /health`                  | `{"ok":true,"calls":N,"clients":N}`.               |

### Environment variables

| Variable           | Default                  | Purpose                                 |
|--------------------|--------------------------|-----------------------------------------|
| `STATS_PATH`       | `/recordings/stats.txt`  | rtl_airband stats file (channel activity). |
| `POLL_INTERVAL_S`  | `1.0`                    | Recordings + stats poll cadence.        |
| `ACTIVE_DECAY_S`   | `2.0`                    | How long an activity dot stays lit after a burst. |
| `RETENTION_HOURS`  | `48`                     | Delete clips off disk older than this.  |
| `RETENTION_SWEEP_S`| `1800`                   | Interval between disk-cleanup sweeps.   |

The in-memory call index is kept to a window narrower than `RETENTION_HOURS`
so the index can never reference a file the sweep has already deleted.

### Channel activity detection

rtl_airband can write Prometheus-format channel metrics to a file
periodically (`stats_filepath = "/recordings/stats.txt"`). The sidecar
diff-tracks `channel_activity_counter` per frequency: when the counter
increments between polls, that channel is flagged `active` for the next
`ACTIVE_DECAY_S` seconds so the activity chip doesn't flicker between the
syllables of one transmission. A snapshot is broadcast to all WebSocket
clients each poll:

```json
{
  "type": "activity",
  "ts": 1731566400.123,
  "channels": {
    "KCWA-TWR": {"freq": "119.750", "active": true,  "activity": 12345,
                 "signal_dbfs": -38.2, "noise_dbfs": -52.1},
    "KCWA-GND": {"freq": "121.900", "active": false, "activity": 421,
                 "signal_dbfs": -54.0, "noise_dbfs": -53.9}
  }
}
```

Channel labels are derived from a single `CHANNELS` table in the sidecar that
drives both the stats parser and the call indexer. Keep the labels and
frequencies in that table mirrored to the channels in `rtl_airband.conf`.

### Clip duration

The sidecar measures each clip's length by **scanning the actual MPEG audio
frames** (`mp3_audio_duration()` in `app.py`) — it does **not** read the MP3's
Xing/Info header.

This is deliberate. rtl_airband writes per-transmission clips whose LAME Xing
header carries a frame count that is *cumulative since the encoder started*,
not per-file. Any header-trusting reader — `mutagen`, `ffprobe -show_format`,
a browser's `<audio>.duration` — therefore reports the channel's entire
airtime-since-boot (tens of minutes) for every short clip; `ffmpeg` itself
flags it with *"filesize and duration do not match"*. Counting frames is the
only reliable measure, and it needs no audio library — just the
bitrate/sample-rate tables in `app.py`.

The raw `.mp3` files still carry the bogus header, so anything playing
`/voice/calls/<id>/audio` directly sees a wrong `<audio>.duration` (playback
still stops correctly at the last real frame). The viewer's voice panel
sidesteps this by displaying the call's frame-scanned `durationS` field rather
than the `<audio>` element's duration.

## Retention

Per-transmission recording is compact — silence is never written, so disk
cost is roughly **10–50 MB/day**. The sidecar's retention sweep deletes
`.mp3` files older than `RETENTION_HOURS` and prunes the empty `YYYY/MM/DD`
directories it leaves behind; it never touches `stats.txt` or other files,
and never removes the channel directories themselves. Each sweep logs a line
(`[retention] sweep: deleted N clips, freed X.X MB`), including no-op runs.

48 hours of clips fits comfortably under a few hundred MB; raise
`RETENTION_HOURS` if you want a deeper archive and have the disk for it.

## Operational notes

- **NFS dependence** — if the server host goes down, rtl_airband's file
  writes to the NFS mount start failing. Worth a Loki/Grafana alert if you
  care about archive completeness.
- **Pi 3 budget** — with the config above, rtl_airband uses ~167% of one core
  (≈42% of the four-core Pi 3) and ~20 MB RAM. The Airspy Mini at 6 MSPS
  draws ~145 Mbit/s over USB 2.0; the Pi 3's shared USB+Ethernet bus has
  ~300 Mbit/s practical headroom, so plenty of margin.
- **Quiet airspace** — if nothing transmits, no clips are produced and the
  call list simply stays as-is. The scanner sits on "listening — waiting for
  activity…" until the next real transmission. To exercise the pipeline
  end-to-end without waiting, briefly drop one channel's `squelch_threshold`
  below the noise floor so it records constantly, then revert.
