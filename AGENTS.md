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

<!-- BEGIN managed by agentic-os/scripts/apply-git-workflow.py -->
### Git workflow

**This repo runs the `pull-request-and-merge` lane**, declared as `ward.workflow` in this file's frontmatter. The agent commits to a task branch, pushes it, opens a GitHub pull request, and **merges that pull request itself** once it is green. The author of the code is the one who merges it. Opening the pull request is a step, never the stopping point.

The fleet runs one lane, and it authorizes the agent end to end. Pushing straight to `main` is over: `merge-remote-main` is retired, so no repo can declare its way back to one.

* `pull-request-and-merge` - the agent commits to a task branch, pushes it, opens a pull request, and merges that pull request itself once it is green.

**Every lane slug names what the AGENT does, never what someone else does.** `pull-request-and-merge` carries the merge because the agent that authored the code merges its own pull request. `pull-request` drops `-and-merge` because the author stops at the pull request and the director merge lane takes over. Reading `pull-request-and-merge` as "someone else merges it later" inverts the two and leaves finished work sitting unmerged.

**These actions are pre-authorized on every lane, and the agent MUST take them without asking first.** Committing, creating a branch, pushing a branch, pushing the lane's own destination, and opening a pull request are ordinary reversible work, not the destructive wall that earns a question. Stopping to ask is how a turn ends with the work stranded in a dirty worktree.

* **ALWAYS commit** in-scope work and **ALWAYS push** it to the canonical remote before pausing, reporting a checkpoint, handing off, or ending a turn. A local-only commit is not a checkpoint.
* **ALWAYS open the pull request** in the same turn as the branch's first push, on every lane except `remote-branch-only`. A pushed branch with no pull request is litter nobody reviews.
* **NEVER `--no-verify`** and **NEVER force-push**. Those two are the real walls, and they stay closed.
* **ALWAYS merge your own pull request on `pull-request-and-merge`**, in the same turn, as soon as it is green. Reporting it as open and awaiting someone is the failure this lane exists to prevent.
* **A merge refused because the head branch is behind the base branch is yours to fix, never a reason to ask.** Update the branch yourself, with `gh pr update-branch <number> --repo <owner>/<repo>` or by merging `origin/main` into it and pushing, never by force. Wait for green, then merge with `gh pr merge <number> --repo <owner>/<repo> --squash`.
* **NEVER merge on `pull-request` or `remote-branch-only`.** Those two stop where they stop, and the director merge lane carries a `pull-request` from there.
<!-- END managed by agentic-os/scripts/apply-git-workflow.py -->

Use she/her for Kai. No em dashes, italics, or semicolons in prose. Name the
actor in every action sentence.

## Release

After validation, main CI publishes the image
`ghcr.io/coilyco/bluesky-mcp:<full-source-sha>` with the job's `GITHUB_TOKEN`
and `packages: write`. This repo holds no cluster credentials.
`coilyco/deploy` owns rollout through Flux (COI-3042).

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
