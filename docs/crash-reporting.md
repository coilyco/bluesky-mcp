# Crash reporting

With `SENTRY_DSN` set, the server also sends **crashes, and only crashes**, to the Sentry project
`bluesky-mcp`, beside the platform's other error signals. Handled errors stay out, to keep inside
Sentry's shared free quota (Kai's decision on teable:coilyco/deploy#8347). Code: `src/crash.ts`.

- **A crash** is an uncaught exception or an unhandled promise rejection. Both are reported, flushed,
  and still end the process with a non-zero code.
- **Rejections run in `strict` mode.** Registering any `unhandledRejection` listener stops Node's own
  crash, so a lenient mode would keep a broken process serving. `strict` keeps the rejection fatal.
- **Handled errors stay out.** `/mcp` already catches every request failure and logs a fixed line,
  and default integrations are off, so no console integration turns that log into an event.
- **No request or HTTP instrumentation** is enabled, so no request body, header, or credential reaches
  Sentry through breadcrumbs or spans.
- Each process sends at most 20 events a minute. A failed init logs the error name only, never the
  DSN, and never stops the server.
