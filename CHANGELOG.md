# Changelog

All notable changes to this project are documented here.

## Unreleased

- Refined the dashboard with a quieter warm-neutral visual system inspired by minimalist Komari interfaces.
- Added persistent Chinese / English language controls and light / dark themes across the dashboard and route editor.
- Separated browser API access, translations, preferences, and theme tokens into maintainable frontend modules.
- Reworked the README around reusable architecture, deployment, security, and contributor guidance.

## 2.4.1 - 2026-07-17

- Mirrored the Agent credential registry into the persistent data directory and automatically restore it when `config/agents.json` is accidentally lost.
- Added a guarded dashboard updater that stops SQLite cleanly, backs up all runtime state, preserves the Agent registry fingerprint, and verifies health after restart.
- Added an Agent-only updater that preserves the existing config, token, target, and Agent ID.
- Added a systemd watchdog and unlimited restart window so a stuck DNS/network call cannot leave a probe process alive but inert.
- Added a recovery command that merges a previous Agent registry without replacing newer token hashes.

## 2.4.0 - 2026-07-17

- Renamed the public project to TopoMari and added the canonical GitHub repository links.
- Replaced environment-specific topology data with synthetic Alpha/Beta examples.
- Moved the editable runtime topology to ignored `config/topology.json`; the repository now ships `config/topology.example.json`.
- Made Agent bootstrap derive Agent and edge definitions from the saved topology.
- Rewrote setup and deployment documentation for reusable public installations.
- Added an MIT license, contribution guide, security policy, and GitHub Actions CI.
- Removed internal handoff notes and binary release archives from the source tree.

## 2.3.2 - 2026-07-17

- Added a visible collecting indicator when only one valid latency sample is available.
- Added cache keys for frontend entry assets.

## 2.3.1 - 2026-07-17

- Fixed route-editor overflow for long names.
- Added first-report verification and stronger systemd checks to the private probe installer.
- Improved Agent status refresh in the editor.

## 2.3.0 - 2026-07-16

- Added the authenticated topology editor, one-time enrollment codes, private probe storage, and per-edge health thresholds.
