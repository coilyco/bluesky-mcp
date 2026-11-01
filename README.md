# bluesky-mcp

`bluesky-mcp` is Kai's authenticated, strictly read-only Bluesky MCP. It uses
the official AT Protocol SDK to create and refresh an internal app-password
session, and the official MCP SDK streamable-HTTP transport to serve a small,
reviewed tool surface.

## Transport and configuration

The process serves `GET /healthz` and MCP streamable HTTP at `POST /mcp`.
Defaults are `HOST=0.0.0.0` and `PORT=9113`. Set these runtime variables:

- `BSKY_APP_PASSWORD` (required): app password supplied only at runtime.
- `BSKY_HANDLE` (optional): authenticated account handle; defaults to
  `coilysiren.me`.
- `MCP_ALLOWED_HOSTS` (optional): comma-separated hosts accepted by the MCP
  transport's DNS-rebinding defense. It defaults to local development hosts.

Run locally with an app password supplied out of band:

```sh
just install
BSKY_APP_PASSWORD=... just run
```

## Exact tool inventory

1. `get_profile`
2. `search_profiles`
3. `search_posts`
4. `get_author_feed`
5. `get_posts`
6. `get_post_thread`
7. `list_followers`
8. `list_follows`
9. `get_home_timeline`
10. `list_notifications`
11. `get_kai_liked_posts`

All page sizes are bounded to 50 or below. Post batches are capped at 25 and
thread depth plus parent height at 6.

## Threat model

The configured app password can authorize account writes, so the adapter must
never expose that authority. It has no post, reply, follow, like, repost,
delete, mute, block, report, moderation, chat, account mutation, login,
generic URL, arbitrary XRPC, or raw HTTP tool. Inputs accept only bounded,
validated actors, post AT URIs, cursors, queries, and limits. The app password
and session tokens remain in process memory and credential-shaped result fields
are stripped before an MCP response is created. SDK failures are deliberately
logged without their values.

The source image runs as the non-root `node` user. Deployment access control,
secret injection, and network exposure are intentionally outside this source
repository.

## Development

`just lint`, `just typecheck`, `just test`, `just audit`, and `just precommit`
are the supported validation verbs. A main-branch workflow tests and publishes
the image `ghcr.io/coilyco/bluesky-mcp:<full-source-sha>`. Rollout is Flux from
`coilyco/deploy` (COI-3042).

## See also

- [AGENTS.md](AGENTS.md) - agent operating rules for this repository.
- [docs/FEATURES.md](docs/FEATURES.md) - inventory of what ships today.
- [justfile](justfile) - dev verbs.
- [.ward/ward.yaml](.ward/ward.yaml) - catalog metadata only.
