import { createChatGptBackend } from "./chatgpt";
import { createCommandBackend } from "./command";
import type { Backend } from "./types";

export type BackendConfig = { command?: string };

export function createBackend(name: string, config: BackendConfig = {}): Backend {
  switch (name) {
    case "chatgpt":
      return createChatGptBackend();
    case "command":
      return createCommandBackend(config.command ?? "");
    default:
      throw new Error(`Unknown backend: ${name} (expected chatgpt or command)`);
  }
}

export { createChatGptBackend, resolveEndpoint } from "./chatgpt";
export { createCommandBackend, splitCommand } from "./command";
export type { Backend, BackendLimits, BackendRequest, ChunkingMode } from "./types";
