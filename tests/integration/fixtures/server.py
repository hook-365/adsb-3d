#!/usr/bin/env python3
"""Deterministic readsb HTTP and ACARS TCP fixtures for public CI."""

from __future__ import annotations

import json
import socketserver
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class FeederHandler(BaseHTTPRequestHandler):
    request_count = 0
    lock = threading.Lock()

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[fixture-http] {fmt % args}", flush=True)

    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        if self.path == "/health":
            self._send_json({"status": "fixture-healthy"})
            return

        if self.path == "/data/aircraft.json":
            with self.lock:
                type(self).request_count += 1
                tick = type(self).request_count
            offset = min(tick, 1000) * 0.0001
            self._send_json(
                {
                    "now": time.time(),
                    "messages": 1000 + tick,
                    "aircraft": [
                        {
                            "hex": "abc123",
                            "flight": "TST123 ",
                            "lat": 51.5000 + offset,
                            "lon": -0.1200 + offset,
                            "alt_baro": 12000 + tick,
                            "alt_geom": 12100 + tick,
                            "gs": 250.0,
                            "track": 90.0,
                            "baro_rate": 64,
                            "squawk": "7000",
                            "category": "A3",
                            "r": "G-TEST",
                            "t": "A320",
                            "desc": "CI fixture aircraft",
                            "messages": 500 + tick,
                            "seen": 0.1,
                        },
                        {
                            "hex": "def456",
                            "flight": "TST456 ",
                            "lat": 51.5100 - offset,
                            "lon": -0.1100 - offset,
                            "alt_baro": 8000,
                            "gs": 180.0,
                            "track": 270.0,
                            "category": "A2",
                            "messages": 200 + tick,
                            "seen": 0.2,
                        },
                    ],
                }
            )
            return

        if self.path == "/tracks/abc123":
            self._send_json(
                {
                    "source": "remote-fixture",
                    "icao": "abc123",
                    "positions": [],
                }
            )
            return

        self._send_json({"detail": "not found", "path": self.path}, 404)


class AcarsHandler(socketserver.BaseRequestHandler):
    messages = (
        {
            "flight": "TST123",
            "tail": "G-TEST",
            "icao": "abc123",
            "label": "Q0",
            "block_id": "1",
            "msg_num": "001",
            "text": "CI OOOI fixture",
            "freq": 131.55,
            "level": -25,
            "error": 0,
            "dsta": "EGLL",
            "lat": 51.5,
            "lon": -0.12,
            "alt": 12000,
        },
        {
            "flight": "TST456",
            "tail": "G-CI02",
            "icao": "def456",
            "label": "H1",
            "msg_num": "002",
            "text": "CI operational fixture",
            "freq": 136.975,
            "level": -30,
            "error": 0,
        },
    )

    def handle(self) -> None:
        for message in self.messages:
            try:
                self.request.sendall(json.dumps(message).encode() + b"\n")
            except (BrokenPipeError, ConnectionResetError):
                break
        time.sleep(0.1)


class ReusableThreadingTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "http"
    if mode == "http":
        print("[fixture-http] listening on :8080", flush=True)
        ThreadingHTTPServer(("0.0.0.0", 8080), FeederHandler).serve_forever()
    elif mode == "acars":
        print("[fixture-acars] listening on :15550", flush=True)
        ReusableThreadingTCPServer(("0.0.0.0", 15550), AcarsHandler).serve_forever()
    else:
        raise SystemExit(f"unknown fixture mode: {mode}")


if __name__ == "__main__":
    main()

