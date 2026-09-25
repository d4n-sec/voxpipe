import { expect, test } from "bun:test";
import { loadCredentials } from "../src/auth";
import { AuthError } from "../src/errors";

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

test("rejects an expired CODEX_STT_TOKEN", () => {
  const token = jwt({ exp: Math.floor(Date.now() / 1000) - 60 });
  expect(() => loadCredentials({ CODEX_STT_TOKEN: token })).toThrow(AuthError);
  expect(() => loadCredentials({ CODEX_STT_TOKEN: token })).toThrow(
    "ChatGPT login has expired. Run `codex` to refresh it, then retry.",
  );
});

test("accepts a non-expired CODEX_STT_TOKEN", () => {
  const token = jwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
  const credentials = loadCredentials({ CODEX_STT_TOKEN: token });
  expect(credentials.accessToken).toBe(token);
});

test("accepts an opaque env token that has no exp claim", () => {
  const credentials = loadCredentials({ CODEX_STT_TOKEN: "opaque-token" });
  expect(credentials.accessToken).toBe("opaque-token");
});
