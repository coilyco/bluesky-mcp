import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import test, { type TestContext } from "node:test";
import { gunzipSync } from "node:zlib";

import { CRASH_EVENTS_PER_MINUTE, crashWithinBudget, initCrashReporting, resetCrashBudget } from "../src/crash.js";

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

async function runChild(scenario: string, dsn: string | undefined): Promise<number | null> {
  const script = `import { initCrashReporting } from ${JSON.stringify(crashModule)};\n`
    + `initCrashReporting(${JSON.stringify(dsn ? { SENTRY_DSN: dsn } : {})});\n${scenario}`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: "ignore" });
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
