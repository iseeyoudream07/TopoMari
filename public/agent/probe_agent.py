#!/usr/bin/env python3

import argparse
import json
import signal
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path


STOP_EVENT = threading.Event()


def log(message):
    timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    print(f"[{timestamp}] {message}", flush=True)


def load_config(path):
    with Path(path).open("r", encoding="utf-8") as handle:
        config = json.load(handle)
    required = ["server_url", "agent_id", "token", "probes"]
    missing = [key for key in required if not config.get(key)]
    if missing:
        raise ValueError(f"missing config keys: {', '.join(missing)}")
    if not isinstance(config["probes"], list) or not config["probes"]:
        raise ValueError("probes must contain at least one TCP target")
    config["interval_seconds"] = max(5, int(config.get("interval_seconds", 30)))
    config["timeout_seconds"] = max(1.0, float(config.get("timeout_seconds", 5)))
    config["verify_tls"] = config.get("verify_tls", True) is not False
    return config


def measure_tcp(probe, timeout_seconds):
    edge_id = str(probe["edge_id"])
    host = str(probe["host"])
    port = int(probe["port"])
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout_seconds):
            latency_ms = round((time.perf_counter() - started) * 1000, 1)
        return {
            "edge_id": edge_id,
            "success": True,
            "latency_ms": latency_ms,
        }
    except Exception as error:  # Network errors differ across operating systems.
        return {
            "edge_id": edge_id,
            "success": False,
            "error": f"{type(error).__name__}: {error}"[:200],
        }


def submit(config, samples):
    endpoint = f"{config['server_url'].rstrip('/')}/api/ingest"
    payload = json.dumps({"samples": samples}, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {config['token']}",
            "Content-Type": "application/json",
            "User-Agent": "TopoMari-Probe/1.0",
            "X-Agent-ID": config["agent_id"],
        },
    )
    context = ssl.create_default_context() if config["verify_tls"] else ssl._create_unverified_context()
    try:
        with urllib.request.urlopen(request, timeout=max(10, config["timeout_seconds"] + 5), context=context) as response:
            response_body = response.read().decode("utf-8", errors="replace")
            if response.status != 202:
                raise RuntimeError(f"ingest returned HTTP {response.status}: {response_body[:200]}")
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ingest returned HTTP {error.code}: {body[:200]}") from error


def run_cycle(config):
    samples = [measure_tcp(probe, config["timeout_seconds"]) for probe in config["probes"]]
    submit(config, samples)
    summary = ", ".join(
        f"{sample['edge_id']}={sample.get('latency_ms', 'failed')}ms" if sample["success"] else f"{sample['edge_id']}=failed"
        for sample in samples
    )
    log(f"submitted {summary}")


def stop(_signal_number, _frame):
    STOP_EVENT.set()


def main():
    parser = argparse.ArgumentParser(description="Private TCP probe for TopoMari")
    parser.add_argument("--config", default="/etc/komari-topology-agent.json")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    config = load_config(args.config)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    while not STOP_EVENT.is_set():
        cycle_started = time.monotonic()
        try:
            run_cycle(config)
        except Exception as error:
            log(f"cycle failed: {type(error).__name__}: {error}")
            if args.once:
                return 1
        if args.once:
            return 0
        elapsed = time.monotonic() - cycle_started
        STOP_EVENT.wait(max(1, config["interval_seconds"] - elapsed))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        log(f"fatal: {type(error).__name__}: {error}")
        sys.exit(1)
