import * as Sentry from "@sentry/node";

// Sentry receives crashes only (teable:coilyco/deploy#8347). Why each choice
// holds: docs/crash-reporting.md.
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

type Init = typeof Sentry.init;

export function initCrashReporting(env: NodeJS.ProcessEnv = process.env, init: Init = Sentry.init): boolean {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return false;
  try {
    init({
      dsn,
      environment: env.OTEL_DEPLOYMENT_ENVIRONMENT ?? "homelab",
      defaultIntegrations: false,
      integrations: [
        Sentry.onUncaughtExceptionIntegration(),
        Sentry.onUnhandledRejectionIntegration({ mode: "strict" }),
        Sentry.linkedErrorsIntegration(),
        Sentry.dedupeIntegration(),
      ],
      beforeSend: (event) => (crashWithinBudget(Date.now()) ? event : null),
    });
    return true;
  } catch (error) {
    // The name only: an invalid DSN's message can carry the DSN.
    console.warn(`Sentry initialization failed (${error instanceof Error ? error.name : typeof error})`);
    return false;
  }
}
