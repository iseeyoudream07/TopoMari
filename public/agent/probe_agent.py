#!/usr/bin/env python3

import argparse
import json
import os
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
AGENT_VERSION = "1.1.0"


def log(message):
    timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    print(f"[{timestamp}] {message}", flush=True)


def systemd_notify(message):
    address = os.environ.get("NOTIFY_SOCKET", "")
    if not address:
        return
    if address.startswith("@"):
        address = f"\0{address[1:]}"
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as notifier:
            notifier.connect(address)
            notifier.sendall(message.encode("utf-8"))
    except OSError as error:
        log(f"systemd notification failed: {type(error).__name__}: {error}")


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
            "User-Agent": f"TopoMari-Probe/{AGENT_VERSION}",
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
    samples = []
    for probe in config["probes"]:
        samples.append(measure_tcp(probe, config["timeout_seconds"]))
        systemd_notify("WATCHDOG=1\nSTATUS=Measuring configured probe targets")
    submit(config, samples)
    summary = ", ".join(
        f"{sample['edge_id']}={sample.get('latency_ms', 'failed')}ms" if sample["success"] else f"{sample['edge_id']}=failed"
        for sample in samples
    )
    log(f"submitted {summary}")


def wait_for_next_cycle(delay_seconds):
    deadline = time.monotonic() + max(0, delay_seconds)
    while not STOP_EVENT.is_set():
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return
        STOP_EVENT.wait(min(30, remaining))
        if not STOP_EVENT.is_set():
            systemd_notify("WATCHDOG=1\nSTATUS=Waiting for the next probe cycle")


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
    systemd_notify(f"READY=1\nSTATUS=TopoMari probe {AGENT_VERSION} running")

    try:
        while not STOP_EVENT.is_set():
            cycle_started = time.monotonic()
            try:
                run_cycle(config)
            except Exception as error:
                log(f"cycle failed: {type(error).__name__}: {error}")
                if args.once:
                    return 1
            finally:
                systemd_notify("WATCHDOG=1\nSTATUS=Probe cycle completed")
            if args.once:
                return 0
            elapsed = time.monotonic() - cycle_started
            wait_for_next_cycle(max(1, config["interval_seconds"] - elapsed))
        return 0
    finally:
        systemd_notify("STOPPING=1\nSTATUS=TopoMari probe stopping")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        log(f"fatal: {type(error).__name__}: {error}")
        sys.exit(1)
