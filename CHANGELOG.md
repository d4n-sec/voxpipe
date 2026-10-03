# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.4] - 2026-10-03

### Fixed

- Write plain transcripts correctly when multiple inputs include segmented output.
- Invalidate resume state when backend settings, language, prompt, model, or segment boundaries change.
- Preserve historical output files while reporting only current generated output, excluding a previous merged transcript when the current merge fails.
- Respect duration ceilings when choosing, previewing, and merging chunks while preserving explicit `chunking = "none"` behavior.
- Include the required output directory in the MCP client configuration example.

### Changed

- Document trusted-client access requirements and per-request command execution for HTTP services.

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

[Unreleased]: https://github.com/d4n-sec/voxpipe/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/d4n-sec/voxpipe/compare/v0.1.3...v0.1.4
[0.1.0]: https://github.com/d4n-sec/voxpipe/releases/tag/v0.1.0
