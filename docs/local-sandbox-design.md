# Local sandbox using server-owned corpuses

Implementation is available through `npm run dev:sandbox`. This document records
the design; the [sandbox guide](local-sandbox.md) describes the delivered commands,
including password resets. The verification items below are the design's test
plan, not a claim that every path has been exercised on every runtime.

The design targets the corpus foundation merged in
[server PR #411](https://github.com/hubuum/hubuum/pull/411). Corpus generation,
maintenance, and restore verification belong to the server repository.

## Decision and initial target

Use the server's `comprehensive` backup as the first sandbox corpus. The frontend
launcher selects a server image, downloads the corpus from that image's exact
source revision, restores it into an isolated disposable database, and starts
host-side Next.js with the resulting connection settings.

The existing `hubuum-admin --verify-backup` and `--restore` commands provide the
loading interface. Published images need no server checkout or Rust toolchain.
Commits and PRs without published images can use an isolated source checkout and
the server's Dockerfile; compilation then runs inside the container build.

Initial target:

| Item | Value |
| --- | --- |
| Server source revision | `5baa9008cce9929b123624067266d3fe221eeb69` |
| Published image tag | `ghcr.io/hubuum/hubuum-server:sha-5baa9008cce9929b123624067266d3fe221eeb69` |
| Image index digest | `sha256:54b96bbd12b8aa476c0ea3e922940c58793bda5b67678edacff01852e2f91b6d` |
| Verified platforms | `linux/amd64`, `linux/arm64` |
| Corpus | `comprehensive` |
| Recipe revision | `2` |
| Backup format | `6` |
| Backup bytes | `25,206,572` |
| Backup SHA-256 | `0fba27a0688f074018bf81d723f96331009b3bc70f9625a54eb7e3b99314510e` |

On 2026-09-13, the
[merge CI run](https://github.com/hubuum/hubuum/actions/runs/34725749740) completed
successfully and the image was confirmed published. Registry checks verified
the index digest and both platform images' source-revision labels against the
commit above. Pin the full image reference for integration runs:

```text
ghcr.io/hubuum/hubuum-server@sha256:54b96bbd12b8aa476c0ea3e922940c58793bda5b67678edacff01852e2f91b6d
```

The matching files are the
[backup](https://raw.githubusercontent.com/hubuum/hubuum/5baa9008cce9929b123624067266d3fe221eeb69/test-corpora/comprehensive.json),
[manifest](https://raw.githubusercontent.com/hubuum/hubuum/5baa9008cce9929b123624067266d3fe221eeb69/test-corpora/comprehensive.manifest.json),
and [recipe](https://raw.githubusercontent.com/hubuum/hubuum/5baa9008cce9929b123624067266d3fe221eeb69/test-corpora/recipe.json).
The [server corpus guide](https://github.com/hubuum/hubuum/blob/5baa9008cce9929b123624067266d3fe221eeb69/test-corpora/README.md)
defines the scenarios and maintenance contract.

This selects a development sandbox target. The released frontend compatibility
target remains governed by [compatibility](compatibility.md).

## Selecting a tag, commit, PR, or image digest

Accept exactly one target selector for a fresh sandbox:

| Selector | Meaning | Resolution |
| --- | --- | --- |
| `--tag main` or `--tag vX.Y.Z` | Published Hubuum Server image tag | Pull the tag once, pin its registry digest, and read its source revision |
| `--sha 5baa9008` | Full or abbreviated Git commit SHA | Resolve to a unique full commit, then use `sha-<full-commit>` or build that commit locally |
| `--pr 411` | PR number in `hubuum/hubuum` | Resolve the PR's selected commit, then use its published SHA image or build locally |
| `--pr https://github.com/hubuum/hubuum/pull/411` | The same PR by URL | Validate the host and repository, then resolve as above |
| `--image ghcr.io/hubuum/hubuum-server@sha256:<digest>` | Exact published image | Pull that digest and read its source revision |

Keep Git commit SHAs distinct from container image digests. `--sha` accepts
7–40 hexadecimal characters, verifies the returned full SHA matches that prefix,
and rejects unknown or ambiguous prefixes. `--image` takes the full registry
reference with its SHA-256 digest. Conflicting selectors fail before network or
container work. Tags refer to registry tags, not arbitrary Git branches.

For an open PR, select `head.sha`. A closed, unmerged PR also selects its last
head when the source remains available. For a merged PR, select the actual
`merge_commit_sha`, which includes the result of squash/rebase merging as
reported by GitHub. Do not use an open PR's synthetic test-merge commit.
For example, `--pr 411` resolves to `5baa9008cce9929b123624067266d3fe221eeb69`;
use `--sha 898c757cd44262506bc0943ec69b1f94e73e96e5` to reproduce its original
head instead. Show PR state and the selected full SHA before setup begins.

Resolve mutable inputs once per fresh run and freeze the resulting commit.
Capture the original selector, PR number/state, head repository when relevant,
full commit, platform, image identity, and corpus identity in sandbox state.
A force-push, later merge, or moving tag must not change a run already resolving
or provisioning. `resume` always uses the recorded image and database. A fresh
run resolves again; `--sha` or `--image` reproduces an earlier choice explicitly.

Use GitHub's API to resolve PR metadata and abbreviated commits. Missing source,
API rate limits, and authorization failures return actionable errors; do not
silently select `main`. GitHub credentials stay in the resolver process and must
not be forwarded into the server build or runtime containers.

### When no published image exists

The server's
[PR container check](https://github.com/hubuum/hubuum/blob/5baa9008cce9929b123624067266d3fe221eeb69/.github/workflows/ci.yml#L1163-L1208)
builds with `push: false`; the
[main publishing job](https://github.com/hubuum/hubuum/blob/5baa9008cce9929b123624067266d3fe221eeb69/.github/workflows/ci.yml#L2007-L2059)
publishes `sha-<commit>` images. PR selection therefore needs a local-build path.

For `--sha` and `--pr`, first look for the exact commit's published image. On a
confirmed missing manifest, use a matching cached local build or build the exact
commit. `--no-build` disables this fallback for callers that require a published
image. Registry timeouts, authentication failures, or a source-label mismatch
are errors, not evidence that an image is missing. Tag and digest selectors
require their requested published image; they never substitute source builds.

Build from a clean, detached checkout in the sandbox's ignored source cache,
without changing either developer checkout. For fork PRs, fetch through the
canonical repository's PR head ref and verify that it yields the full SHA pinned
from PR metadata. If the ref moved, retrieve the pinned commit or fail explicitly.
Read the corpus, recipe, and manifest from that same verified source tree; a
missing or incompatible corpus requires a server-side update, not frontend
generation or substitution from a different revision.
Check artifact presence and checksum metadata before the expensive build; run
the selected image's offline backup verifier after the build completes.

Use that commit's Dockerfile with the production feature flags, locked Cargo
dependencies, and `HUBUUM_BUILD_GIT_SHA=<full-commit>`. Set source/revision labels
explicitly and record the actual source and fork provenance. The build context
contains only the selected tracked source snapshot; do not add `.env.local`,
host credentials, SSH agents, or host sockets, or run repository scripts on the
host. Report build progress and allow cancellation with cleanup of owned work.
The container build requires network access and can take substantially longer
than pulling an image.

Cache local builds by full commit, platform, Dockerfile identity, and build
arguments. Base images and locked dependencies still affect rebuild identity;
record the resulting image ID rather than claiming a source SHA determines
identical image bytes. Use only the launcher-recorded cache entry whose labels
match. A local image may have no registry `RepoDigest`: retain its immutable
local image ID, use it for every role with pulling disabled, and record that the
image was locally built. `resume` requires that exact image to remain present;
it must not silently rebuild a replacement. Runtime configuration and the BFF
boundary remain the same for published and locally built targets.

## Image and corpus matching

The launcher must resolve the server and corpus as one unit:

1. Resolve the selector and obtain its image as above. Record the registry digest
   or local image ID and platform. Read `org.opencontainers.image.revision` from
   that image and require the full SHA to match the selected source revision.
   Validate source provenance against the repository selected by the resolver.
2. Obtain `test-corpora/<name>.manifest.json`, its backup, and the recipe from
   that exact commit, by download or from the verified detached source tree.
   Never fetch the corpus independently from a moving `main` branch. Initially
   support only `comprehensive`; unknown names fail explicitly.
3. Validate the manifest shape, name, recipe revision and recipe checksum,
   backup byte count, and backup SHA-256. Bound all downloads; the current corpus
   has a 25 MiB ceiling. Use atomic cache writes and reject incomplete files.
4. Run the matching image's offline backup verification before allocating the
   database or restoring anything. Invalid artifacts prevent startup.
5. Record the image identity, source revision, corpus name, recipe revision, and
   artifact checksum together in the sandbox state and verification output.

Use fixed upstream repository URLs. Treat manifest content as data, never shell
arguments or executable instructions. Cache artifacts outside Git under ignored
`.local/`, keyed by source revision, name, and checksum. Recheck cached bytes.
The backup's `source_version` is its producing package version; it is not a
sufficient compatibility key. In this manifest it says `0.0.14` even though the
backup is format 6 and the released v0.0.14 server uses format 5.

The server's guarantee comes from testing the committed artifact against the
server at the containing revision, plus independent regeneration and restore
verification. An artifact can remain unchanged across compatible server commits.
Do not require regeneration solely because the server commit changed.

Older images or commits without a matching corpus fail with an actionable
unsupported-target error. Published images must have a source-revision label;
local builds must have the provenance recorded by the launcher. There is no
fallback to the newest corpus or acceptance of unrelated local image tags.

## Initial corpus and later coverage

`comprehensive` contains 3,000 live objects in twelve classes, with four classes
per schema policy:

| Policy | Classes and object counts |
| --- | --- |
| No schema | `untyped-empty` (0), `untyped-notes` (100), `untyped-locations` (300), `untyped-assets` (600) |
| Defined, enforcement disabled | `advisory-servers` (100), `advisory-switches` (200), `advisory-services` (300), `advisory-applications` (400) |
| Enforced | `enforced-servers` (100), `enforced-switches` (200), `enforced-services` (300), `enforced-applications` (400) |

It also contains five collections including the system root, three class
relations, 300 object relations, 45 shared computed definitions, and one personal
definition owned by `corpus-reader`. Scenarios cover inherited permissions,
hidden relation endpoints, updated and deleted object history, and retired,
active, and staged schema revisions. The manifest supplies stable anchor IDs.

The named accounts are `corpus-admin`, `corpus-editor`, `corpus-reader`, and
`corpus-outsider`; the standard `admin` account also exists. Editor and reader
can see 1,600 objects while the restricted collection contains the other 1,400.
Backups exclude password hashes and bearer tokens, so credentials are provisioned
after every fresh restore.

The graph has 100 four-object components with maximum degree three and 2,600
isolated objects. It covers basic relation and visibility behavior. A later
server-owned relation corpus should add high-degree anchors, deeper paths,
dense components, and larger relation lists. Other useful follow-ups are a small
`smoke` corpus, more than 250 classes/collections for selector pagination,
duplicate names across collection paths, and executable report templates.
The current corpus has no export templates or external integration records.

These are follow-up corpus proposals, not supported names in the first launcher.
The existing server `large` and `huge` scale profiles remain separate benchmark
inputs until the server publishes them through a supported corpus distribution
path. Keep large artifacts and generation code in the server's ownership.

## Frontend command and lifecycle

Proposed npm interface:

```sh
# Select a published tag, a Git commit, or a PR.
npm run dev:sandbox -- --tag main --corpus comprehensive
npm run dev:sandbox -- --sha 5baa9008
npm run dev:sandbox -- --pr 411
npm run dev:sandbox -- --pr https://github.com/hubuum/hubuum/pull/411

# Require a published image for this commit; disable the local-build fallback.
npm run dev:sandbox -- --sha 5baa9008 --no-build

# Retain this run, then resume its exact image and edited data later.
npm run dev:sandbox -- --tag main --name review --keep
npm run dev:sandbox -- resume --name review

# Inspect or remove the named sandbox's owned resources.
npm run dev:sandbox -- status --name review
npm run dev:sandbox -- down --name review
```

Require exactly one of `--tag`, `--sha`, `--pr`, or `--image` for a fresh run;
default the corpus to `comprehensive`. There is no generation seed option:
repeatability comes from restoring the exact artifact. Fresh runs resolve mutable
targets again; resume uses the recorded image identity and existing database.

Use a dedicated `compose.sandbox.yml` and Node launcher alongside the existing
scripts. Reuse established runtime detection, readiness checks, and frontend
port/listen options. Preserve the Valkey-only `dev:deps` and externally configured
`dev` workflows. The stack owns PostgreSQL, one-shot administrator jobs, Hubuum,
the restore executor, and dedicated Valkey. All server roles use the same registry
digest or immutable local image ID.

Startup order:

1. Resolve and verify the image and corpus as above. Check the frontend port and
   checkout lock before allocating services. Create a project/run ID owned by
   this checkout, with state under `.local/sandboxes/<name>/`. An existing name
   requires `resume` or `down`; never replace it implicitly.
2. Start private PostgreSQL and Valkey. Wait for health and migrate the new
   database with the selected image. Keep API and worker processes stopped.
3. Mount the verified backup read-only in a one-shot administrator container and
   run `--restore <path> --restore-confirmation "REPLACE ALL HUBUUM DATA"` against
   that owned database. This uses offline CLI restore; no web restore capability
   or asynchronous confirmation flow is needed during initial provisioning.
4. Start the matching server and restore executor. Wait for `/readyz`, then
   provision login credentials and wait for schema revalidation and computed
   rebuilding to satisfy the corpus's documented checks.
5. Launch `scripts/dev-server.mjs` with explicit server-only `BACKEND_BASE_URL`,
   `VALKEY_URL`, and per-run session/settings prefixes in its child environment.
   Browser requests retain normal BFF routing and cookie authentication.
6. Print the frontend/backend URLs, image identity, corpus identity, verified
   counts, and cleanup command. Ctrl-C stops the owned frontend and removes the
   stack and volumes unless `--keep` was supplied. A failed stage prevents
   frontend startup; retain failed containers only when explicitly requested.

Bind published services to IPv4 loopback. PostgreSQL does not need a published
port. Prefer dynamically allocated backend and Valkey ports discovered through
Compose; forward existing `--port` and `--listen` frontend options. Never kill an
existing process to free a port. Use shell-free child-process arguments and
deadlines for every stage. Timeout and subprocess errors must redact credentials
as carefully as ordinary nonzero exits.

Keep `.env.local` unchanged. Override inherited backend/session connection values
with the verified sandbox values, and never accept a remote database or backend
URL for restoration. The state file contains identities, ports, and owned
resource references, with no passwords, tokens, or restore capabilities.
`down` checks ownership labels and removes exact recorded resources; it does not
prune globally or delete a project solely because its name matches. `resume`
requires the recorded image and database; missing state must not silently reseed.

Each fresh run gets a new database. Changing server versions must not implicitly
migrate or downgrade a retained database. Upgrade testing is a separate workflow.
Multiple backend stacks can coexist, but initially run one Next.js instance per
checkout because development output and locking are shared. Parallel frontend
comparisons require separate checkouts and browser contexts: cookies are scoped
by host, not port. Device-local browser preferences are outside the corpus.

## Login and readiness

Capture `hubuum-admin --reset-password admin` output in memory and use the issued
credential for temporary administrative API access. For interactive development,
prompt without echo for a developer-chosen local password and set it on the
selected corpus account through the existing user-update API, preserving its
concurrency requirements. Offer the same provisioning for other corpus accounts
when needed. Authenticate through the ordinary login page afterward. Revoke the
bootstrap token and discard temporary credentials when provisioning finishes.

For authenticated Playwright tests, reset `admin` immediately before the run and
supply the generated credential only to the test child as `E2E_PASSWORD`, with
`E2E_USERNAME=admin`. Never print or persist generated passwords, and never put
passwords or tokens in command arguments. Backend bearer tokens remain on the
server side of the frontend's BFF boundary. Resume retains existing password
hashes and requires no corpus reload.

Readiness needs both healthy dependencies and completed restore follow-up work.
Poll the documented enforced-class counts and computed examples with bounded
timeouts; retain history by keeping event retention purging disabled. Verify
stable anchors and expected counts before reporting the sandbox ready. Keep the
full, mutating scenario suite as an explicit test run: it edits restored objects
and must not run automatically before an everyday development session.

## Delivery and verification

The frontend tooling provides argument parsing, artifact matching/cache
validation, owned container lifecycle, login provisioning, and the Next.js
wrapper. It adds no corpus generation or backup-format conversion. Consider a
server-owned machine-readable corpus catalogue when multiple corpuses are
published; the first version can use the known `comprehensive` file convention.

Test selector conflicts, ambiguous/unknown SHAs, invalid PR URLs, open/closed/merged
PR resolution, fork heads, force-push races, and moving-tag snapshot behavior.
Cover missing published images versus registry/authentication failures,
`--no-build`, local build cancellation, stale build caches, local images without
registry digests, and resume after an image is removed. Also test
image/corpus mismatch, missing corpus artifacts, absent source labels,
unsupported corpus names, corrupted/truncated downloads, cached checksums,
environment precedence, occupied ports, failed migrations/restores/readiness,
credential redaction including timeout paths, interrupted startup, keep/resume,
stale state, and cleanup that preserves unrelated services.

Run the real stack against the published merge image, check normal BFF login,
multi-page object browsing, schema-policy display, computed values, relations,
and restricted-reader permissions. Record the image digest and corpus checksum
in test output, and measure startup time and resource use before setting budgets.
Exercise both a published commit image and a locally built PR commit using the
same corpus assertions; the local path must not depend on the developer's server
checkout or host Rust toolchain.
