# Changelog

All notable changes to this project are documented here.

## Unreleased

## 2.7.0 - 2026-07-18

- Simplified the admin login heading and return link copy.
- Added a Settings > General submenu with a native Glassmorphism preset, live preview, automatic day/night behavior, and validated custom light/dark colors.
- Persisted visual theme settings in the existing topology configuration and exposed only sanitized palette fields to the public dashboard.
- Added third-party attribution for the MIT-licensed Komari Glassmorphism palette and glass-surface ideas.

## 2.6.0 - 2026-07-18

- Added a Komari-style admin console with session login, route management, and a Settings > Site submenu.
- Made the dashboard public while keeping all admin, editor, probe inventory, and diagnostic APIs authenticated.
- Added editable site name, description, persistent PNG/ICO favicon, and Beijing sunrise/sunset theme automation.
- Simplified the public header to the data-source label, theme switch, and admin entry.

## 2.5.1 - 2026-07-17

- Switched Simplified Chinese text to Noto Serif SC and temporarily hid the language switch while preserving its implementation.
- Replaced the opaque square favicon with the supplied transparent circular TopoMari artwork.
- Added separate backend-configurable site and main-title branding values, both defaulting to TopoMari.

## 2.5.0 - 2026-07-17

- Refined the dashboard with a quieter warm-neutral visual system inspired by minimalist Komari interfaces.
- Added persistent Chinese / English language controls and light / dark themes across the dashboard and route editor.
- Separated browser API access, translations, preferences, and theme tokens into maintainable frontend modules.
- Replaced the default topology mark with the new TopoMari icon in the browser and dashboard header.
- Switched interface typography to Arimo for Latin text and Noto Serif TC for Chinese text, with larger type throughout the dashboard and editor.
- Reduced repeated headings, helper copy, technical IDs, and other low-value interface text while keeping status and safety information visible.
- Rewrote the README in Simplified Chinese around server deployment, first-time use, features, safe updates, and common problems.

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
