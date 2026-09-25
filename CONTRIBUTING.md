# Contributing

Thanks for taking the time to contribute.

## Development setup

```bash
git clone https://github.com/d4n-sec/voxpipe.git
cd voxpipe
bun install
bun run typecheck
bun test
```

Requires [Bun](https://bun.sh) and `ffmpeg` / `ffprobe` for end-to-end runs.

## Guidelines

- Keep the runtime Bun-based: the transcription endpoint rejects non-Bun TLS fingerprints.
- Never write to `~/.codex/auth.json` or otherwise manage credentials; auth is read-only.
- Do not add network calls to the test suite. Use a fake `Backend` and the injectable options.
- Keep pure logic (segmentation, merging, config) free of I/O so it stays unit-testable.
- Run `bun run typecheck` and `bun test` before opening a pull request.

## Pull requests

- Describe the behavior change and how you verified it.
- Add or update tests for non-trivial logic.
- Keep commits focused and the diff small.

## Reporting issues

Use GitHub Issues. For security-sensitive reports, see [SECURITY.md](./SECURITY.md).
