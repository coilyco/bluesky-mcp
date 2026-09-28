# Crash reporting

With `SENTRY_DSN` set, the server also sends **crashes, and only crashes**, to the Sentry project
`bluesky-mcp`, beside the platform's other error signals. Each crash carries everything the default
integrations annotate, with user data scrubbed (Kai's decision on teable:coilyco/deploy#8347). Code:
`src/crash.ts`.

- **A crash** is an uncaught exception or an unhandled promise rejection. Both are reported, flushed,
  and still end the process with a non-zero code.
- **Rejections run in `strict` mode.** Registering any `unhandledRejection` listener stops Node's own
  crash, so a lenient mode would keep a broken process serving. `strict` keeps the rejection fatal.
- **Every default integration stays on**, for annotation: console and HTTP breadcrumbs, runtime, OS and
  module context, context lines, and local variables. None of them raises an event for a handled error,
  so `/mcp`'s logged "MCP request failed" stays a breadcrumb.
- **Scrubbing runs in `beforeSend`.** Credential and Bluesky-content keys (passwords, JWTs, sessions,
  `identifier`, post and record text, feeds, threads, notifications, profiles) are filtered at any depth
  in frame locals, request, extra, contexts and breadcrumbs. A request body is filtered whatever its keys
  are. The values of credential-named environment variables and any JWT-shaped string are also redacted
  wherever they appear, including log lines and source context.
- **Local variables need the SDK's worker attached**, which happens shortly after startup. On Node 26 a
  synchronous uncaught exception exits before the worker delivers its locals, while a rejection keeps
  them.
- Each process sends at most 20 events a minute. A failed init logs the error name only, never the
  DSN, and never stops the server.
