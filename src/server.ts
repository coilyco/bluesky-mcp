import { BskyAgent } from "@atproto/api";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { initCrashReporting } from "./crash.js";
import { SERVICE_ICON } from "./icon.js";

const SERVICE_NAME = "bluesky-mcp";
const SERVICE_VERSION = "1.0.0";
const ENTRYWAY_URL = "https://bsky.social";
const DEFAULT_HANDLE = "coilysiren.me";
const PORT = Number.parseInt(process.env.PORT ?? "9113", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const MCP_ALLOWED_HOSTS = Object.freeze((process.env.MCP_ALLOWED_HOSTS ?? "localhost:9113,127.0.0.1:9113")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean));

const TOOL_NAMES = Object.freeze([
  "get_profile", "search_profiles", "search_posts", "get_author_feed", "get_posts",
  "get_post_thread", "list_followers", "list_follows", "get_home_timeline",
  "list_notifications", "get_kai_liked_posts",
]);

const actorPattern = /^(?:did:[a-z0-9:%._-]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/i;
const atUriPattern = /^at:\/\/(?:did:[a-z0-9:%._-]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})\/app\.bsky\.feed\.post\/[a-z0-9]+$/i;
const cursorPattern = /^[\x21-\x7e]{1,512}$/;

function fail(message: string): never {
  throw new Error(message);
}

function validatedActor(actor: string): string {
  if (!actorPattern.test(actor)) fail("actor must be a handle or DID");
  return actor;
}

function validatedUri(uri: string): string {
  if (!atUriPattern.test(uri)) fail("uri must be an at:// DID post URI");
  return uri;
}

function validatedCursor(cursor: string | undefined): string | undefined {
  if (cursor !== undefined && !cursorPattern.test(cursor)) fail("cursor must be a printable, bounded opaque cursor");
  return cursor;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/(?:password|passphrase|secret|(?:access|refresh)[_-]?jwt|(?:session|auth|access|refresh)[_-]?token)/i.test(key))
      .map(([key, item]) => [key, redact(item)]));
  }
  return value;
}

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(redact(value)) }] };
}

class AuthenticatedBluesky {
  #agent = new BskyAgent({ service: ENTRYWAY_URL });
  #login: Promise<void> | undefined;

  async agent(): Promise<BskyAgent> {
    if (!this.#login) {
      const password = process.env.BSKY_APP_PASSWORD;
      if (!password) fail("Bluesky credential is not configured");
      // BskyAgent owns the official session manager, including refreshes.
      this.#login = this.#agent.login({ identifier: process.env.BSKY_HANDLE ?? DEFAULT_HANDLE, password })
        .then(() => undefined)
        .catch((error: unknown) => {
          this.#login = undefined;
          throw error;
        });
    }
    await this.#login;
    return this.#agent;
  }
}

const bluesky = new AuthenticatedBluesky();
const actor = z.string().trim().min(3).max(253).transform(validatedActor);
const postUri = z.string().trim().max(512).transform(validatedUri);
const cursor = z.string().trim().max(512).optional().transform(validatedCursor);
const query = z.string().trim().min(1).max(300);
const page = (defaultValue: number, maximum = 50) => z.number().int().min(1).max(maximum).default(defaultValue);

export function createMcpServer(client = bluesky): McpServer {
  const server = new McpServer({
    name: SERVICE_NAME,
    version: SERVICE_VERSION,
    websiteUrl: "https://bluesky.coilysiren.me",
    icons: [SERVICE_ICON],
  });
  const registeredTools: string[] = [];
  const read = (name: string, description: string, inputSchema: Record<string, z.ZodType>, handler: (input: any) => Promise<unknown>) => {
    registeredTools.push(name);
    // The SDK's schema inference becomes recursively deep for a generic
    // registry helper. Runtime schemas still validate every registered input.
    (server.registerTool as any)(name, { description, inputSchema }, async (input: any) => result(await handler(input)));
  };

  read("get_profile", "Get one Bluesky profile by handle or DID.", { actor }, async ({ actor: value }) => (await client.agent()).getProfile({ actor: value }));
  read("search_profiles", "Search Bluesky profiles by text.", { query, limit: page(20), cursor }, async ({ query: value, limit, cursor: pageCursor }) => (await client.agent()).searchActors({ term: value, limit, cursor: pageCursor }));
  read("search_posts", "Search public Bluesky posts by text.", { query, limit: page(20), cursor }, async ({ query: value, limit, cursor: pageCursor }) => (await client.agent()).app.bsky.feed.searchPosts({ q: value, limit, cursor: pageCursor }));
  read("get_author_feed", "Get an author's feed by handle or DID.", { actor, limit: page(20), cursor }, async ({ actor: value, limit, cursor: pageCursor }) => (await client.agent()).getAuthorFeed({ actor: value, limit, cursor: pageCursor }));
  read("get_posts", "Get up to 25 posts by AT URI.", { uris: z.array(postUri).min(1).max(25) }, async ({ uris }) => (await client.agent()).getPosts({ uris }));
  read("get_post_thread", "Get a bounded post thread by AT URI.", { uri: postUri, depth: z.number().int().min(0).max(6).default(3), parentHeight: z.number().int().min(0).max(6).default(3) }, async ({ uri, depth, parentHeight }) => (await client.agent()).getPostThread({ uri, depth, parentHeight }));
  read("list_followers", "List followers for a handle or DID.", { actor, limit: page(25), cursor }, async ({ actor: value, limit, cursor: pageCursor }) => (await client.agent()).getFollowers({ actor: value, limit, cursor: pageCursor }));
  read("list_follows", "List accounts followed by a handle or DID.", { actor, limit: page(25), cursor }, async ({ actor: value, limit, cursor: pageCursor }) => (await client.agent()).getFollows({ actor: value, limit, cursor: pageCursor }));
  read("get_home_timeline", "Get Kai's authenticated Bluesky home timeline.", { limit: page(25), cursor }, async ({ limit, cursor: pageCursor }) => (await client.agent()).getTimeline({ limit, cursor: pageCursor }));
  read("list_notifications", "List Kai's authenticated Bluesky notifications.", { limit: page(25), cursor }, async ({ limit, cursor: pageCursor }) => (await client.agent()).listNotifications({ limit, cursor: pageCursor }));
  read("get_kai_liked_posts", "Get posts liked by Kai's authenticated Bluesky account.", { limit: page(25), cursor }, async ({ limit, cursor: pageCursor }) => (await client.agent()).getActorLikes({ actor: process.env.BSKY_HANDLE ?? DEFAULT_HANDLE, limit, cursor: pageCursor }));

  if (registeredTools.join("\n") !== TOOL_NAMES.join("\n")) fail("reviewed tool inventory drifted");
  return server;
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.get("/healthz", (_request, response) => response.status(200).json({ service: SERVICE_NAME }));
  app.all("/mcp", async (request, response) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: [...MCP_ALLOWED_HOSTS],
    });
    const server = createMcpServer();
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      if (!response.headersSent) response.status(500).json({ error: "MCP request failed" });
      // Never log an SDK error: session and credential-bearing values can appear in it.
      console.error("MCP request failed");
    } finally {
      await transport.close();
    }
  });
  return app;
}

export function startServer() {
  initCrashReporting();
  const listener = createApp().listen(PORT, HOST, () => console.log(`${SERVICE_NAME} listening`));
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    listener.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return listener;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) startServer();

export { ENTRYWAY_URL, MCP_ALLOWED_HOSTS, TOOL_NAMES, redact };
