---
ward:
  workflow: pull-request-and-merge
---
# Agent instructions

## Scope

`bluesky-mcp` is one TypeScript process that exposes Kai's authenticated
Bluesky reads over streamable HTTP. It is intentionally a finite, read-only
adapter. There is no frontend, database, generic network proxy, or mutation
surface.

## Project shape

The MCP server is TypeScript under `src/`, built to `dist/`. `src/icon.ts`
carries the service icon, and `scripts/` holds the shell and Python that CI
steps invoke on one line.

## Repo boundaries

This repository owns source, tests, image construction, and image publishing.
Deployment manifests, secret mappings, external access policy, and rollout
automation belong only in `coilyco-bridge/deploy`.

## Commands

Run development commands through `ward` using the verbs in `.ward/ward.yaml`.
Do not put credentials, session values, deployment hostnames, or infrastructure
details in tracked files or logs.

## Safety

- Keep the reviewed 11-tool inventory exact and read-only.
- Do not add arbitrary XRPC, URL, raw HTTP, login, session, or record tools.
- The app password and SDK session tokens must remain process-local and be
  redacted from all returned values and errors.
- Preserve bounded page sizes, post batch size, and thread depth.

## Validation

Run `just lint`, `just typecheck`, `just test`, `ward audit`, and `ward
precommit` before landing source changes.

## Cross-repo contracts

The catalog pre-commit hooks are authored in agentic-os and consumed here by
upstream rev, never forked. Deployment policy, pull credentials, and secret
mapping are owned by deploy, not here.

## Agent rules

Use she/her for Kai. No em dashes, italics, or semicolons in prose. Name the
actor in every action sentence.

## Release

After validation, main CI publishes the private image
`forgejo.coilysiren.me/coilyco-flight-deck/bluesky-mcp:<full-source-sha>`
through the trusted deploy lane. The runner supplies `REGISTRY_TOKEN` for
package writes. `coilyco-bridge/deploy` owns the separate read-only
`forgejo-registry` pull credential and rollout.

## Checkout residency

This repo is not in Agent Compose's `repository-plan.yaml`, so it has no
resident checkout under `~/projects/<owner>/`. That is intentional. Work it
from a task-scoped temporary clone, and remove that clone once the work lands.

A temporary root can be purged at any time, so commit and push before pausing,
switching tasks, or ending a session. The remote is the only durable artifact.

## See also

- [README.md](README.md) - human-facing intro.
- [docs/FEATURES.md](docs/FEATURES.md) - inventory of what ships today.
- [justfile](justfile) - dev verbs.
- [.ward/ward.yaml](.ward/ward.yaml) - catalog metadata only.
