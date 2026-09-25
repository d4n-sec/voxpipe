# voxpipe

Turn video/audio into text from the command line. Audio is sent to the ChatGPT (Codex) transcription backend, long files are split on silences so nothing is lost, and a pluggable offline backend lets you use local tools such as `whisper.cpp`.

> ⚠️ **免责声明（重要）**
>
> 本项目使用的是**未公开**的接口（`https://chatgpt.com/backend-api/transcribe`），并非 OpenAI 官方产品，与 OpenAI 没有任何关联。
>
> - 如果你的**权益受到侵犯**，请联系 **d4n.for.sec@gmail.com**，我们会在 **7 天内处理**。
> - 该接口可能随时变更、限流或要求设备校验，使用风险（包括账号被限流/封禁、数据被上传到第三方）由使用者自行承担。
> - 请仅用于你自己有权处理的内容，并遵守当地法律与相关服务条款。
> - 本项目按“原样”提供，不提供任何担保。

## Features

- Any ffmpeg-readable input, text out (`txt`; a directory when segmented).
- **Silence-aware chunking**: target ~4 min, hard ceiling 10 min, prefer a cut at a silence.
- **Fallback chunking**: when no silence is available, blind cuts with 20s overlap; output is a directory with per-segment files, `manifest.json`, and a best-effort `merged.txt`.
- **Read-only auth**: never refreshes and never writes `~/.codex/auth.json`.
- **Resumable**: segmented runs checkpoint progress under `.voxpipe/`.
- **Pluggable backends**: built-in `chatgpt`, plus an offline `command` backend.
- Runs on [Bun](https://bun.sh) (required: curl/Python/Node TLS fingerprints are rejected with HTTP 403 by the endpoint).

## Install

Once published to npm, the CLI ships as a small Node launcher plus per-platform
prebuilt binaries (declared as `optionalDependencies`, so npm installs only the
one matching your OS/CPU):

```bash
npm i -g @d4n-sec/voxpipe     # global install
npx @d4n-sec/voxpipe --help   # one-off, no global install
```

The launcher resolves `@d4n-sec/voxpipe-<platform>-<arch>` and runs its bundled
binary; if no prebuilt binary is available for your platform it falls back to
running the TypeScript entry with [Bun](https://bun.sh) when `bun` is on `PATH`.

> **Until the packages are published to npm**, install from source:

```bash
git clone https://github.com/d4n-sec/voxpipe.git && cd voxpipe
bun install
bun run bin/voxpipe.ts --help
```

Either way you need `ffmpeg` and `ffprobe` on `PATH`.


## Usage

```bash
voxpipe video.mp4                      # text to stdout
voxpipe audio.m4a -l zh -o out.txt     # language hint, write a file
voxpipe a.mp4 b.wav -o outdir/         # multiple inputs
voxpipe long.mp4 --dry-run             # preview the plan, no network
voxpipe long.mp4 --json                # newline-delimited JSON events on stdout
```

### Flags

| Flag | Description | Default |
|---|---|---|
| `-o, --out <path>` | Output file, or directory when segmented | |
| `-l, --language <code>` | Language hint, e.g. `zh`/`en`/`ja` | auto |
| `-p, --prompt <text>` | Prompt hint | |
| `--prompt-file <path>` | Custom vocabulary, one term per line (joined into the prompt) | |
| `-m, --model <name>` | Model name | `gpt-4o-transcribe` |
| `--backend <name>` | `chatgpt` or `command` | `chatgpt` |
| `--command <cmd>` | Command for the `command` backend; placeholders `{file}` `{language}` `{model}` | |
| `--chunk-seconds <n>` | Target chunk length | `240` |
| `--max-seconds <n>` | Hard chunk ceiling | `600` |
| `--overlap-seconds <n>` | Overlap when cutting blind | `20` |
| `--silence-db <n>` | Silence threshold in dB | `-35` |
| `--silence-dur <n>` | Minimum silence length in seconds | `0.35` |
| `--retry <n>` | Total attempts, 1–3 (1 = no retry) | `1` |
| `--json` | Newline-delimited JSON events on stdout (progress → stderr otherwise) | |
| `--dry-run` | Print the segmentation plan, no network | |
| `--keep` | Keep intermediate audio | |
| `--keep-state` | Keep resume state after a successful run | |
| `--config <path>` | Config file | `~/.config/voxpipe/config.toml` |
| `-h, --help` | Help | |

### JSON output

With `--json`, **stdout is newline-delimited JSON**: every line is exactly one
JSON object and nothing else is written to stdout (human-readable progress goes
to stderr when `--json` is absent). Progress events carry a `type`; the final
line for each input is an `input` event.

| `type` | Emitted when | Key fields |
|---|---|---|
| `probe` | the input has been decoded and measured | `duration`, `sizeBytes` |
| `plan` | the segmentation plan is ready | `mode`, `fallback`, `segmentCount` |
| `segment-start` | a segment upload begins | `index`, `total`, `start`, `end`, `overlapped` |
| `segment-done` | a segment finishes | `index`, `total`, `chars`, `cached` |
| `retry` | a failed segment is retried | `index`, `attempt`, `delayMs`, `reason` |
| `preview` | `--dry-run --json` for each input | `file`, `duration`, `mode`, `segments` |
| `done` | a run finishes (progress event) | `mode`, `chars`, optional `outDir` |
| `input` | final result for each input | `input`, `mode`, `fallback`, plus `text` or `outDir`/`segments` |

```bash
voxpipe talk.mp3 --json | while IFS= read -r line; do
  printf '%s\n' "$line" | node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"))'
done
```

### Commands

- `voxpipe clean [--dir <path>]` — remove `.voxpipe/` state directories (default: cwd).
- `voxpipe mcp --out-dir <path> [--http] [--host 127.0.0.1] [--port 8765]` — MCP server (stdio by default, Streamable HTTP with `--http`; refuses to start without `--out-dir`).
- `voxpipe serve --out-dir <path> [--host 127.0.0.1] [--port 8787]` — HTTP API for transcription (refuses to start without `--out-dir`).

## MCP server

Runs an MCP server on top of the official `@modelcontextprotocol/sdk`, exposing two tools and streaming progress notifications while a transcription runs.

`--out-dir` is **required at startup** (same rule as `serve`); without it the process prints the usage and exits with code 2, so segmented output can never land in the MCP client's working directory.

```bash
voxpipe mcp --out-dir /var/voxpipe/out                       # stdio transport (for MCP clients that spawn a process)
voxpipe mcp --out-dir /var/voxpipe/out --http                # Streamable HTTP at http://127.0.0.1:8765/mcp
voxpipe mcp --out-dir /var/voxpipe/out --http --host 0.0.0.0 --port 9000
```

Tools:

- `transcribe` — args `{ path, language?, prompt?, model?, backend?, command?, outDir? }`. Calls the core `transcribe()`; returns the transcript for single/joined runs, or `{ mode: "segmented", outDir, segments, files, manifest?, merged? }` for segmented runs. When `outDir` is omitted it uses the server's `--out-dir`; a per-call `outDir` overrides it.
- `transcribe_plan` — args `{ path, targetSeconds?, maxSeconds?, overlapSeconds?, minSegmentSeconds?, silenceWindowFraction?, silenceDb?, silenceDur? }`. Returns the segmentation plan from `previewInput()` and never contacts the API.

While `transcribe` runs, the server emits `notifications/progress` mapped from the core `ProgressEvent`s (with `total` = segment count once known) whenever the client requested progress. Errors are returned as MCP tool errors; an auth failure tells you to run `codex login`.

Example client entry (stdio):

```json
{ "mcpServers": { "voxpipe": { "command": "voxpipe", "args": ["mcp"] } } }
```

## HTTP API

```bash
voxpipe serve --out-dir /var/voxpipe/out [--host 127.0.0.1] [--port 8787]
```

`--out-dir` is **required at startup**; without it the process prints the usage and exits with code 2, so segmented output can never land in the server's cwd. A request may still pass `outDir` to override the server default for that request.

Never exposes tokens, binds to `127.0.0.1` by default, and shuts down cleanly on `SIGINT`/`SIGTERM`.

- `GET /healthz` → `{ "ok": true, "version": "0.1.0" }`.
- `POST /transcribe` — accepts **either** `multipart/form-data` with a `file` part (optional `language`, `prompt`, `model`, `backend`, `command`, `outDir`) **or** JSON `{ path, language?, prompt?, model?, backend?, command?, outDir? }`. Uploads are written to a temp file and cleaned up; the request body is capped at 200 MB.

Response format is controlled by `?format=`:

- `format=json` (default) → `{ "mode": "single"|"joined", "text": "..." }`, or `{ "mode": "segmented", "outDir", "segments", "files", ... }`.
- `format=text` → plain `text/plain` for single/joined runs.

Send `Accept: text/event-stream` (or `?progress=1`) to stream server-sent events: one `data: <ProgressEvent JSON>` per progress event, followed by a final `event: result` with the outcome (or `event: error`).

```bash
# multipart upload, JSON result
curl -s http://127.0.0.1:8787/transcribe \
  -F file=@media/audio.m4a -F language=zh -F backend=command \
  -F 'command=sh -c "echo hi"' -F outDir=/tmp/voxpipe-out

# JSON with a server-side path, plain text out
curl -s 'http://127.0.0.1:8787/transcribe?format=text' \
  -H 'content-type: application/json' \
  -d '{"path":"/tmp/audio.m4a","backend":"command","command":"sh -c \"echo hi\"","outDir":"/tmp/voxpipe-out"}'

# SSE progress stream
curl -N http://127.0.0.1:8787/transcribe \
  -H 'Accept: text/event-stream' \
  -F file=@media/audio.m4a -F backend=command \
  -F 'command=sh -c "echo hi"' -F outDir=/tmp/voxpipe-out
```

## Chunking and output

- Clean silence cuts throughout → a single text (segments joined; CJK-aware, no spaces for zh/ja/ko/yue).
- Any blind/overlapped cut → an output directory containing:
  - `seg_0001_000000-000240.txt` per segment,
  - `manifest.json` (time ranges, overlap flag),
  - `merged.txt` **only when every boundary merges cleanly** (longest-suffix overlap removal).
- Progress is always rendered to **stderr**; stdout stays clean for pipes.

## Configuration

`~/.config/voxpipe/config.toml` (flat `key = value`):

```toml
language = "zh"
model = "gpt-4o-transcribe"
backend = "chatgpt"
target_seconds = 240
max_seconds = 600
overlap_seconds = 20
min_segment_seconds = 15
silence_window_fraction = 0.7
silence_db = -35
silence_dur = 0.35
retries = 1
# command = "whisper-cli -m ggml-base.bin -f {file} -l {language}"
```

Precedence: **CLI > env (`VOXPIPE_*`) > config file > defaults**. Environment keys mirror the file: `VOXPIPE_LANGUAGE`, `VOXPIPE_MODEL`, `VOXPIPE_BACKEND`, `VOXPIPE_COMMAND`, `VOXPIPE_TARGET_SECONDS`, `VOXPIPE_MAX_SECONDS`, `VOXPIPE_OVERLAP_SECONDS`, `VOXPIPE_MIN_SEGMENT_SECONDS`, `VOXPIPE_SILENCE_WINDOW_FRACTION`, `VOXPIPE_SILENCE_DB`, `VOXPIPE_SILENCE_DUR`, `VOXPIPE_RETRIES`, `VOXPIPE_CONFIG`.

## Backends / plugins

- `chatgpt` (default) — POSTs audio to `https://chatgpt.com/backend-api/transcribe` using your existing login.
- `command` — runs a local command; stdout (trimmed) is the transcript. This is how you plug in `whisper.cpp`, `faster-whisper`, etc. **This project bundles no models.**

```bash
voxpipe talk.mp3 --backend command \
  --command "whisper-cli -m models/ggml-base.bin -f {file} -l {language}"
```

Non-zero exit from the command is an error. Placeholders are replaced per argument (quotes are respected).

## Auth (read-only)

voxpipe never manages your credentials:

- Reads `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`) and uses `tokens.access_token` / `tokens.account_id` as-is.
- Never refreshes, never writes, never modifies any file.
- Missing login, expired JWT, or a rejected session produce an actionable error telling you to run `codex login`.
- Bypass files entirely with `CODEX_STT_TOKEN` / `CODEX_STT_ACCOUNT_ID`.

## Known limits / risks

- Undocumented, unofficial endpoint; it may change, rate-limit, or require device attestation at any time.
- A single request is silently truncated for long audio (observed around **14–15 minutes**), which is why files are chunked.
- Transcription content passes through a third-party service; mind your privacy.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build                 # compiles bin/voxpipe.ts per platform into dist/
bun run pack:platforms        # builds + assembles dist/npm/@d4n-sec/voxpipe-<key>/
bun run scripts/pack-platforms.ts bun-linux-x64   # single target
```

## License

MIT © d4n-sec. See [LICENSE](./LICENSE).
