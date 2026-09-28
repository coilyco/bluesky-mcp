import * as Sentry from "@sentry/node";
import type { ErrorEvent } from "@sentry/node";

// Sentry receives crashes only, each fully annotated (teable:coilyco/deploy#8347).
// Why each choice holds: docs/crash-reporting.md.
export const CRASH_EVENTS_PER_MINUTE = 20;
const crashWindow: number[] = [];

export function crashWithinBudget(now: number): boolean {
  while (crashWindow.length > 0 && (crashWindow[0] ?? now) <= now - 60_000) crashWindow.shift();
  if (crashWindow.length >= CRASH_EVENTS_PER_MINUTE) return false;
  crashWindow.push(now);
  return true;
}

export function resetCrashBudget(): void {
  crashWindow.length = 0;
}

// Keys whose values are credentials or Bluesky content, matched at any depth.
const USER_DATA_KEY = new RegExp(
  "^(?:password|passphrase|secret|identifier|authorization|cookie|cookies"
    + "|access_?jwt|refresh_?jwt|jwt|session|session_?token|auth_?token|access_?token|refresh_?token"
    + "|app_?password|bsky_app_password"
    + "|text|body|content|record|records|embed|post|posts|feed|thread|replies|reply"
    + "|notifications|followers|follows|profiles|actors|description|display_?name|facets)$",
  "i",
);
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const FILTERED = "[Filtered]";

function secretValues(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env)
    .filter(([key, value]) => /password|secret|token|jwt/i.test(key) && typeof value === "string" && value.length >= 6)
    .map(([, value]) => value as string);
}

function scrubString(value: string, secrets: string[]): string {
  let out = value.replace(JWT, FILTERED);
  for (const secret of secrets) out = out.split(secret).join(FILTERED);
  return out;
}

export function scrub(value: unknown, secrets: string[], depth = 0): unknown {
  if (typeof value === "string") return scrubString(value, secrets);
  if (depth > 12 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, secrets, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, USER_DATA_KEY.test(key) ? FILTERED : scrub(item, secrets, depth + 1)]));
}

export function scrubEvent(event: ErrorEvent, env: NodeJS.ProcessEnv = process.env): ErrorEvent {
  const secrets = secretValues(env);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubString(exception.value, secrets);
    for (const frame of exception.stacktrace?.frames ?? []) {
      if (frame.vars) frame.vars = scrub(frame.vars, secrets) as typeof frame.vars;
      if (frame.context_line) frame.context_line = scrubString(frame.context_line, secrets);
      frame.pre_context = frame.pre_context?.map((line) => scrubString(line, secrets));
      frame.post_context = frame.post_context?.map((line) => scrubString(line, secrets));
    }
  }
  if (event.message) event.message = scrubString(event.message, secrets);
  if (event.request) {
    event.request = scrub(event.request, secrets) as typeof event.request;
    // A request body is user content whatever its keys are.
    if (event.request.data !== undefined) event.request.data = FILTERED;
  }
  if (event.extra) event.extra = scrub(event.extra, secrets) as typeof event.extra;
  if (event.contexts) event.contexts = scrub(event.contexts, secrets) as typeof event.contexts;
  if (event.breadcrumbs) event.breadcrumbs = scrub(event.breadcrumbs, secrets) as typeof event.breadcrumbs;
  return event;
}

type Init = typeof Sentry.init;

export function initCrashReporting(env: NodeJS.ProcessEnv = process.env, init: Init = Sentry.init): boolean {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return false;
  try {
    init({
      dsn,
      environment: env.OTEL_DEPLOYMENT_ENVIRONMENT ?? "homelab",
      sendDefaultPii: false,
      includeLocalVariables: true,
      // Every default integration annotates the crash. Only the rejection
      // handler changes, to strict, so a rejection still ends the process.
      integrations: (defaults) => [
        ...defaults.filter((integration) => integration.name !== "OnUnhandledRejection"),
        Sentry.onUnhandledRejectionIntegration({ mode: "strict" }),
      ],
      beforeSend: (event) => (crashWithinBudget(Date.now()) ? scrubEvent(event, env) : null),
    });
    return true;
  } catch (error) {
    // The name only: an invalid DSN's message can carry the DSN.
    console.warn(`Sentry initialization failed (${error instanceof Error ? error.name : typeof error})`);
    return false;
  }
}
