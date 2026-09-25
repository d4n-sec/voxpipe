import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AuthError } from "./errors";

export const USER_AGENT = "codex_cli_rs/0.153.4";

export type Credentials = { accessToken: string; accountId?: string };

type AuthFile = {
  auth_mode?: string;
  tokens?: {
    access_token?: string;
    account_id?: string;
    refresh_token?: string;
  };
  [key: string]: unknown;
};

export function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function tokenExpiry(token: string): number | null {
  const claims = decodeJwt(token);
  const exp = claims?.exp;
  return typeof exp === "number" ? exp : null;
}

export function accountIdFromToken(token: string): string | undefined {
  const claims = decodeJwt(token);
  const auth = claims?.["https://api.openai.com/auth"];
  if (auth && typeof auth === "object" && typeof (auth as Record<string, unknown>).chatgpt_account_id === "string") {
    return (auth as Record<string, string>).chatgpt_account_id;
  }
  return undefined;
}

export function authPath(): string {
  const home = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  return join(home, "auth.json");
}

export function loadCredentials(env: Record<string, string | undefined> = process.env): Credentials {
  const fromEnv = env.CODEX_STT_TOKEN?.trim();
  if (fromEnv) {
    const exp = tokenExpiry(fromEnv);
    if (exp !== null && exp * 1000 <= Date.now()) {
      throw new AuthError("ChatGPT login has expired. Run `codex` to refresh it, then retry.");
    }
    return {
      accessToken: fromEnv,
      accountId: env.CODEX_STT_ACCOUNT_ID?.trim() || accountIdFromToken(fromEnv),
    };
  }

  const path = authPath();
  if (!existsSync(path)) {
    throw new AuthError("No ChatGPT login found. Run `codex login` first (or set CODEX_STT_TOKEN).");
  }

  let parsed: AuthFile;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as AuthFile;
  } catch {
    throw new AuthError("No ChatGPT login found. Run `codex login` first (or set CODEX_STT_TOKEN).");
  }

  const token = parsed.tokens?.access_token;
  if (!token) {
    throw new AuthError("No ChatGPT login found. Run `codex login` first (or set CODEX_STT_TOKEN).");
  }

  const exp = tokenExpiry(token);
  if (exp !== null && exp * 1000 <= Date.now()) {
    throw new AuthError("ChatGPT login has expired. Run `codex` to refresh it, then retry.");
  }

  return { accessToken: token, accountId: parsed.tokens?.account_id || accountIdFromToken(token) };
}

export function authHeaders(credentials: Credentials): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${credentials.accessToken}`,
    "user-agent": USER_AGENT,
    originator: "codex_cli_rs",
    version: USER_AGENT.split("/")[1] ?? "0.153.4",
  };
  if (credentials.accountId) headers["chatgpt-account-id"] = credentials.accountId;
  return headers;
}
