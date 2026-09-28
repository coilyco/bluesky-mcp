import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import test, { type TestContext } from "node:test";
import { gunzipSync } from "node:zlib";

import { CRASH_EVENTS_PER_MINUTE, crashWithinBudget, initCrashReporting, resetCrashBudget, scrub, scrubEvent } from "../src/crash.js";

const crashModule = new URL("../src/crash.js", import.meta.url).href;

async function sentryStub(t: TestContext): Promise<{ port: number; envelopes: string[] }> {
  const envelopes: string[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      envelopes.push((request.headers["content-encoding"] === "gzip" ? gunzipSync(body) : body).toString("utf8"));
      response.writeHead(200).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { port: address.port, envelopes };
}

async function runChild(scenario: string, dsn: string | undefined, extra: Record<string, string> = {}): Promise<number | null> {
  const env = { ...(dsn ? { SENTRY_DSN: dsn } : {}), ...extra };
  const script = `import { initCrashReporting } from ${JSON.stringify(crashModule)};\n`
    + `initCrashReporting(${JSON.stringify(env)});\n${scenario}`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: "ignore",
    env: { ...process.env, ...extra },
  });
  return new Promise((resolve) => child.on("exit", (code) => resolve(code)));
}

test("an uncaught exception is sent to Sentry and still ends the process", async (t) => {
  const { port, envelopes } = await sentryStub(t);
  const code = await runChild(`setTimeout(() => { throw new Error("tool loop crashed"); }, 0);`, `http://public@127.0.0.1:${port}/1`);
  assert.notEqual(code, 0);
  assert.ok(envelopes.some((body) => body.includes("tool loop crashed")), "no crash envelope arrived");
});

test("an unhandled rejection is sent to Sentry and still ends the process", async (t) => {
  const { port, envelopes } = await sentryStub(t);
  const code = await runChild(`Promise.reject(new Error("session refresh rejected"));`, `http://public@127.0.0.1:${port}/1`);
  assert.notEqual(code, 0, "a Sentry rejection listener must not keep a crashed process alive");
  assert.ok(envelopes.some((body) => body.includes("session refresh rejected")), "no rejection envelope arrived");
});

test("a handled, logged error stays out of Sentry", async (t) => {
  const { port, envelopes } = await sentryStub(t);
  const code = await runChild(
    `try { throw new Error("upstream 502"); } catch (error) { console.error("MCP request failed", error); }\n`
      + `setTimeout(() => process.exit(0), 500);`,
    `http://public@127.0.0.1:${port}/1`,
  );
  assert.equal(code, 0);
  assert.deepEqual(envelopes, []);
});

test("no DSN leaves crash reporting off", async (t) => {
  const { envelopes } = await sentryStub(t);
  assert.equal(initCrashReporting({}), false);
  const code = await runChild(`setTimeout(() => { throw new Error("unreported"); }, 0);`, undefined);
  assert.notEqual(code, 0);
  assert.deepEqual(envelopes, []);
});

test("the budget caps events per process minute and recovers", () => {
  resetCrashBudget();
  const allowed = Array.from({ length: CRASH_EVENTS_PER_MINUTE + 1 }, () => crashWithinBudget(100_000));
  assert.equal(allowed.filter(Boolean).length, CRASH_EVENTS_PER_MINUTE);
  assert.equal(allowed.at(-1), false);
  assert.equal(crashWithinBudget(161_000), true);
  resetCrashBudget();
});

test("a failed init logs the error name and never the DSN", (t) => {
  const warnings: string[] = [];
  t.mock.method(console, "warn", (message: string) => warnings.push(message));
  const refuse = (() => { throw new TypeError("https://secret-key@o0.ingest.example/1"); }) as never;
  assert.equal(initCrashReporting({ SENTRY_DSN: "https://secret-key@o0.ingest.example/1" }, refuse), false);
  assert.deepEqual(warnings, ["Sentry initialization failed (TypeError)"]);
});

const SECRET = ["hunter", "two", "SECRET"].join("-");

test("a crash carries breadcrumbs and runtime context, with credentials scrubbed", async (t) => {
  const { port, envelopes } = await sentryStub(t);
  const code = await runChild(
    `console.log("logging in with " + process.env.BSKY_APP_PASSWORD);\n`
      + `setTimeout(() => { throw new Error("tool loop crashed"); }, 0);`,
    `http://public@127.0.0.1:${port}/1`,
    { BSKY_APP_PASSWORD: SECRET },
  );
  assert.notEqual(code, 0);
  const all = envelopes.join("\n");
  assert.ok(all.includes("tool loop crashed"), "no crash envelope arrived");
  assert.ok(all.includes("logging in with [Filtered]"), "the console breadcrumb is missing or unscrubbed");
  assert.ok(all.includes("\"runtime\""), "runtime context is missing");
  assert.ok(!all.includes(SECRET), "the app password reached Sentry");
});

test("a rejection keeps a harmless local readable and scrubs the credential", async (t) => {
  const { port, envelopes } = await sentryStub(t);
  const code = await runChild(
    `async function refreshSession() {\n`
      + `  const toolName = "get_profile";\n`
      + `  const password = process.env.BSKY_APP_PASSWORD;\n`
      + `  throw new Error("session refresh rejected");\n`
      + `}\n`
      // The local-variables worker attaches after startup, so give it time.
      + `setTimeout(() => { void refreshSession(); }, 1500);`,
    `http://public@127.0.0.1:${port}/1`,
    { BSKY_APP_PASSWORD: SECRET },
  );
  assert.notEqual(code, 0);
  const all = envelopes.join("\n");
  assert.ok(all.includes("get_profile"), "the harmless local did not reach Sentry");
  assert.ok(!all.includes(SECRET), "the credential local reached Sentry");
});

test("scrub filters user-data keys at any depth and keeps the rest", () => {
  const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJkaWQ6cGxjOnh4eCJ9", "c2lnbmF0dXJlc2lnbmF0dXJl"].join(".");
  const out = scrub(
    { tool: "get_posts", session: { accessJwt: "x" }, nested: { posts: [{ text: "private" }], uri: "at://x" }, note: `Bearer ${jwt}` },
    [],
  ) as Record<string, unknown>;
  assert.deepEqual(out, {
    tool: "get_posts",
    session: "[Filtered]",
    nested: { posts: "[Filtered]", uri: "at://x" },
    note: "Bearer [Filtered]",
  });
});

test("scrubEvent filters a request body whatever its keys are", () => {
  const event = scrubEvent({ type: undefined, request: { method: "POST", url: "/mcp", data: { q: "anything" } } }, {});
  assert.equal(event.request?.data, "[Filtered]");
  assert.equal(event.request?.method, "POST");
});
