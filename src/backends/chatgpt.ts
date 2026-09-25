import { extname } from "node:path";
import { authHeaders, loadCredentials } from "../auth";
import { AuthError, BackendError } from "../errors";
import type { Backend, BackendRequest } from "./types";

export const ENDPOINT = "https://chatgpt.com/backend-api/transcribe";
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function resolveEndpoint(env: Record<string, string | undefined> = process.env): string {
  return env.VOXPIPE_ENDPOINT?.trim() || ENDPOINT;
}

export function createChatGptBackend(): Backend {
  return {
    name: "chatgpt",
    // A single request is silently truncated for long audio (observed around
    // ~14-15 min), so cut on silences and keep every request well under it.
    chunking: "silence",
    limits: { maxInputSeconds: 600, maxInputBytes: MAX_UPLOAD_BYTES },
    async transcribe(req: BackendRequest): Promise<string> {
      const credentials = loadCredentials();
      const bytes = await Bun.file(req.file).arrayBuffer();
      const ext = extname(req.file) || ".webm";
      const form = new FormData();
      form.append("file", new File([bytes], `audio${ext}`, { type: "audio/webm" }));
      if (req.language) form.append("language", req.language);
      if (req.prompt) form.append("prompt", req.prompt);
      if (req.model) form.append("model", req.model);

      let res: Response;
      try {
        res = await fetch(resolveEndpoint(), {
          method: "POST",
          headers: authHeaders(credentials),
          body: form,
          signal: req.signal,
        });
      } catch (error) {
        throw new BackendError(
          `Network error contacting ChatGPT: ${error instanceof Error ? error.message : String(error)}`,
          { retryable: true },
        );
      }

      const body = await res.text();
      if (res.status === 401 || res.status === 403) {
        throw new AuthError(`ChatGPT rejected the session (HTTP ${res.status}). Run \`codex login\` and retry.`);
      }
      if (!res.ok) {
        throw new BackendError(`Transcription failed (HTTP ${res.status}): ${body.slice(0, 500)}`, {
          status: res.status,
        });
      }

      let json: { text?: unknown };
      try {
        json = JSON.parse(body) as { text?: unknown };
      } catch {
        throw new BackendError("Transcription response was not valid JSON", { retryable: false });
      }
      if (typeof json.text !== "string") {
        throw new BackendError("Transcription response is missing text", { retryable: false });
      }
      return json.text;
    },
  };
}
