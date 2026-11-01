# Per-repo task manifest. Run `just` (or `just --list`) to see every verb.
#
# Recipes take trailing arguments directly: `just <verb> a b`, where the
# retired form was `ward exec <verb> -- a b`.
#
# One line of comment per recipe on purpose: just reads only the LAST comment
# line above a recipe, so a wrapped description silently truncates to its tail.
#
# `ward exec` is retired. `.ward/ward.yaml` survives carrying catalog metadata
# only, because the catalog hooks upstream in agentic-os pin that exact path.

set positional-arguments

# Default target: list every available recipe.
default:
    @just --list --unsorted

# Install the pinned dependencies.
install *ARGS:
    @npm ci "$@"

# Build TypeScript and run the unit and inventory tests.
test *ARGS:
    @npm test "$@"

# Lint TypeScript source and tests.
lint *ARGS:
    @npm run lint "$@"

# Type-check TypeScript source and tests.
typecheck *ARGS:
    @npm run typecheck "$@"

# Audit production dependencies for high-severity vulnerabilities.
audit *ARGS:
    @npm run audit "$@"

# Run every repository pre-commit hook.
precommit *ARGS:
    @pre-commit run --all-files "$@"

# Build the non-root bluesky-mcp image locally.
build-docker *ARGS:
    @docker build -t bluesky-mcp:local . "$@"

# Parse the trusted GHCR publisher shell contract.
image-publish-check *ARGS:
    @bash -n scripts/publish-image.sh "$@"

# Run the streamable HTTP MCP locally.
run *ARGS:
    @npm start "$@"
