# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-25

### Added

- Modular multi-file project layout (`bin/`, `src/`, `src/backends/`, `scripts/`, `tests/`).
- Silence-aware segmentation with an overlapped blind-cut fallback (`planSegments`).
- Overlap-aware text merging with a `merged` flag (`mergeOverlapping`).
- Pluggable backends: `chatgpt` (default) and offline `command`.
- Read-only ChatGPT/Codex auth handling (`~/.codex/auth.json`, `CODEX_STT_TOKEN` override).
- Flat TOML config with `CLI > env > file > defaults` precedence.
- Resume support for segmented runs under `<outDir>/.voxpipe/state.json`.
- Newline-delimited JSON progress events (`--json`), progress on stderr.
- CLI commands `mcp`, `serve` (stubs) and `clean`.
- Cross-platform compile script and GitHub Actions CI/release workflows.
- Unit tests for segmentation, merging, and configuration.

[Unreleased]: https://github.com/d4n-sec/voxpipe/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/d4n-sec/voxpipe/releases/tag/v0.1.0
