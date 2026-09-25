# Security Policy

## Supported versions

The latest `0.1.x` release receives security fixes.

## Reporting a vulnerability

Please report suspected vulnerabilities privately by email to **d4n.for.sec@gmail.com**.

Do not open a public GitHub issue for security-sensitive reports. Include:

- a description of the issue and its impact,
- steps to reproduce,
- any relevant logs or proof-of-concept (redact secrets and tokens).

We aim to acknowledge reports within 7 days and to provide a remediation plan
after triage.

## Credential handling

voxpipe reads your existing ChatGPT/Codex login **read-only** and never refreshes,
writes, or transmits it anywhere except to the transcription endpoint. It never
logs or persists access tokens. If you believe a token has been exposed, revoke
it and run `codex login` again.
