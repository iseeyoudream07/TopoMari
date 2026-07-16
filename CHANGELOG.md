# Changelog

All notable changes to this project are documented here.

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
