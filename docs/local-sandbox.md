# Local Hubuum sandbox

Start a disposable Hubuum Server, PostgreSQL, Valkey, and the frontend against a
server-owned test corpus. Use Node.js 24 LTS, `npm ci`, and Docker with Compose or
Podman with a Compose provider. Git is needed when an unpublished commit must be
built. Image pulls and source/corpus downloads require network access.

```sh
# The merged corpus PR is a reproducible starting point.
npm run dev:sandbox -- --pr 411
```

Choose a password for `corpus-admin` at the hidden prompt, then open the frontend
URL printed by the launcher and sign in with that account. Startup checks the
backup with the selected server, restores a fresh database, and waits for schema
validation and computed examples before starting Next.js. `Ctrl-C` stops the
frontend and removes that sandbox's containers, network, and database volume.

The launcher supplies the backend URL and an isolated Valkey connection to the
frontend process. It does not require `dev:deps` or change `.env.local`. Other
frontend configuration still follows the normal environment-loading rules.
Browser requests and login continue through the frontend's BFF.

## Select a server

Pass exactly one selector to a fresh start:

```sh
npm run dev:sandbox -- --tag main
npm run dev:sandbox -- --sha 5baa9008
npm run dev:sandbox -- --pr 411
npm run dev:sandbox -- --pr https://github.com/hubuum/hubuum/pull/411
npm run dev:sandbox -- --image ghcr.io/hubuum/hubuum-server@sha256:54b96bbd12b8aa476c0ea3e922940c58793bda5b67678edacff01852e2f91b6d
```

| Selector | Resolution |
| --- | --- |
| `--tag` | Pull that registry tag and record its digest and source revision. |
| `--sha` | Resolve a full Git SHA or an unambiguous prefix of at least seven characters. |
| `--pr` | Use the PR head for open or closed-unmerged PRs; use the merge commit for merged PRs. |
| `--image` | Use the specified immutable Hubuum registry digest. |

SHA and PR selections first try the published `sha-<full-commit>` image. If the
registry reports that it does not exist, the launcher fetches that exact server
commit and builds its Dockerfile locally. This runs the selected commit's build
instructions; a first Rust release build can take tens of minutes. Local builds use the container
toolchain; no host Rust installation or server checkout is needed. Pass
`--no-build` to require a published image. Registry authentication and network
failures are reported rather than treated as missing images.

The corpus comes from `test-corpora/` at the image's exact source revision. Both
manifest checksums and the image's source labels are checked. A target without
the required corpus artifacts or admin commands fails setup; older releases
predating the corpus are therefore unsuitable. Moving tags and PRs are resolved
once per fresh start. Resume uses the recorded image and existing database.

Optional `GH_TOKEN` or `GITHUB_TOKEN` can raise GitHub API rate limits. Select the
container runtime with `HUBUUM_CONTAINER_RUNTIME=podman` (or an executable path);
the selected executable is recorded for subsequent commands.

## Keep, resume, inspect, and reset

```sh
# Keep a named sandbox, including changes made through the frontend.
npm run dev:sandbox -- --pr 411 --name review --keep --port 4000

# After Ctrl-C, attach the frontend again without restoring the corpus.
npm run dev:sandbox -- resume --name review --keep --port 4000
npm run dev:sandbox -- status --name review

# Remove this sandbox, then recreate it to restore the original corpus.
npm run dev:sandbox -- down --name review
npm run dev:sandbox -- --pr 411 --name review --keep --port 4000
```

`--keep` applies to each start/resume invocation. Omitting it on an attached
frontend run removes the sandbox when that run ends. Stop the attached frontend
with `Ctrl-C` before `resume` or `down`. Password resets can run in a second
terminal while the frontend is attached.

To prepare just the containers without prompting for a login password:

```sh
npm run dev:sandbox -- --pr 411 --name review --keep --no-frontend
npm run dev:sandbox -- password --name review --user corpus-admin
npm run dev:sandbox -- resume --name review --keep
```

Backend and Valkey ports are allocated dynamically on `127.0.0.1`; PostgreSQL has
no published port. `--port` and `--listen` control the frontend (defaults:
`127.0.0.1:3000`). Multiple named container stacks can coexist. Run one Next.js
development process per checkout. For simultaneous frontend comparisons use
separate checkouts and browser contexts, since cookies are scoped by host, not
port.

State, corpus downloads, and local build metadata live under the ignored `.local/`
directory. Cleanup checks checkout/run ownership labels before deleting
resources; it retains downloaded corpuses and cached images for subsequent runs.
Run `down` before removing a sandbox's state directory. If setup fails with
`--keep`, inspect `status`, run `down`, and start again; incomplete restores cannot
be resumed. Resume requires the recorded containers still to be running.

## Set or reset user passwords

Restores do not include usable passwords. The interactive start provisions
`corpus-admin` by default; `--user` selects a different local account. Set or reset
any local sandbox account with the same command:

```sh
npm run dev:sandbox -- password --name review --user corpus-admin
npm run dev:sandbox -- password --name review --user corpus-editor
npm run dev:sandbox -- password --name review --user corpus-reader
npm run dev:sandbox -- password --name review --user corpus-outsider
npm run dev:sandbox -- password --name review --user admin
```

The command prompts twice without echoing input. Choose at least eight
characters. Omit `--name` for the default sandbox. Password changes survive
`--keep`/`resume` and disappear when the database is removed and restored anew.

| Account | Purpose in the comprehensive corpus |
| --- | --- |
| `corpus-admin` | Administrator for normal sandbox work. |
| `corpus-editor` | Edit objects in the permitted collection subtree. |
| `corpus-reader` | Browse the permitted subtree without edit rights. |
| `corpus-outsider` | Exercise denied/empty access. |
| `admin` | Bootstrap administrator used internally by the tooling. |

Use `corpus-admin` for a persistent administrator login: every password command
first rotates `admin` to obtain temporary administrative access, even when
resetting another account. This can invalidate a password you previously chose
for `admin`. The generated bootstrap password and bearer token remain in memory;
the token is revoked after provisioning. Chosen passwords are neither printed
nor written to files. Password updates use the server's user API with its ETag
concurrency guard.

Automation can use `--password-stdin` with either `start` or `password`. Supply a
single password, optionally followed by one newline. For example, in Bash:

```bash
read -r -s -p 'Sandbox reader password: ' sandbox_password
printf '\n'
printf '%s' "$sandbox_password" | npm run dev:sandbox -- password \
  --name review --user corpus-reader --password-stdin
unset sandbox_password
```

Keep shell tracing disabled when supplying credentials. Do not put a password
literal in a command argument or commit it to an environment file.

For authenticated Playwright runs, follow the `admin` reset and in-memory
`E2E_PASSWORD` capture rules in [development.md](development.md#browser-quality-checks)
and `AGENTS.md`; the interactive password command is intended for developer
logins.

## Corpus and checks

`--corpus comprehensive` is currently the sole supported corpus and is the
default. Its recipe at merged PR #411 includes 12 classes and 3,000 objects: four
classes each with absent, advisory, and enforced schemas. It includes collection
permissions, three class relations, 300 object relations, 45 shared computed
field definitions, one personal definition, and history. The object relations
form small connected groups rather than one large connected graph.

The server owns the backup, manifest, and recipe and can evolve them together
with its restore format. The frontend does not generate fixtures or translate
backups. Additional named corpuses can be supported when the server publishes
them; see the [design record](local-sandbox-design.md).

Run the tooling tests with:

```sh
npm run test:sandbox
```

Startup itself checks restored class anchors and every class's object count,
then waits for enforced-schema revalidation and the recipe's computed examples.
It does not run the server's mutating scenario suite during normal development.
