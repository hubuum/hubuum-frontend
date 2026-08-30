# Releasing Hubuum Frontend

Hubuum Frontend releases publish a multi-architecture image, an OCI Helm chart,
a digest-pinned Compose quickstart, checksums, and a GitHub Release.

## Prepare

1. Let the repository's npm and GitHub Actions Dependabot updates finish, then
   merge or supersede every open Dependabot pull request. Update application,
   development, and action dependencies together rather than relying on green
   checks from their individual pull requests.
2. From that combined dependency set, run:

   ```sh
   npm ci
   npm outdated --long
   npm run release:dependencies
   npm run audit:prod
   ```

   `release:dependencies` queries the npm registry, verifies every external
   workflow `uses:` pin against the latest stable action tag and commit, and
   blocks on open Dependabot pull requests. It uses the current repository from
   authenticated `gh`; set `GITHUB_REPOSITORY=owner/repository` when running it
   outside a checkout recognized by `gh`.
3. Prefer updating a dependency over deferring it. When a concrete
   compatibility constraint makes that impossible, add an exact entry to
   `release-dependency-exceptions.json` in the release pull request:

   ```json
   {
     "exceptions": [
       {
         "ecosystem": "npm",
         "dependency": "example-package",
         "currentVersion": "1.2.3",
         "targetVersion": "2.0.0",
         "reason": "Version 2 requires a backend contract not yet supported.",
         "trackingIssue": "https://github.com/hubuum/hubuum-frontend/issues/123",
         "expiresOn": "2026-10-01",
         "pullRequest": 456
       }
     ]
   }
   ```

   Use `github-actions` for an action exception. `pullRequest` is optional, but
   is required when an open Dependabot pull request must remain unresolved.
   The gate rejects expired, imprecise, duplicate, and unused exceptions. Copy
   the compatibility reason into the release pull request and its `CHANGELOG`
   section so it is present in the generated release notes.
4. Update `package.json`, `package-lock.json`, the Helm chart, Compose defaults,
   and `CHANGELOG.md` to the same release version. Merge this final combined
   release change to `main` through one pull request only after its `validate`,
   `backend-contract`, `browser-quality`, `visual-regression`,
   `authenticated-browser-smoke`, `authenticated-browser`, and `package`
   checks pass.
5. Wait for `validate`, `backend-contract`, `browser-quality`,
   `visual-regression`, `authenticated-browser-smoke`, `package`, and
   `publish-main` to pass on the exact merged `main` commit. The publisher
   builds AMD64 and ARM64 images on matching native GitHub-hosted runners,
   assembles the multi-architecture manifest, and publishes its attestation and
   development chart.
6. Dispatch **Release readiness** on that exact `main` commit:

   ```sh
   gh workflow run release-readiness.yml --ref main
   gh run list --workflow release-readiness.yml --branch main --limit 1 \
     --json databaseId,headSha,status,conclusion,url
   ```

   This release-blocking workflow reruns dependency freshness and exception
   validation, confirms the exact commit's full main CI run, and runs the
   complete authenticated browser suite against the combined dependency set.
   Wait for its `release-readiness` job to succeed and confirm the listed head
   SHA is the commit that will be tagged.
7. Check out that clean commit and run:

   ```sh
   bash scripts/check-release-readiness.sh v0.0.13
   ```

## Publish

Create and push an annotated tag from the verified commit:

```sh
git tag -a v0.0.13 -m "Hubuum Frontend v0.0.13"
git push origin v0.0.13
```

The tag workflow rechecks dependency freshness and unresolved Dependabot pull
requests, requires the successful pre-tag **Release readiness** run and main CI
run for that exact commit, builds AMD64 and ARM64 images on matching native
runners, assembles and attests the release manifest, publishes the chart and
quickstart bundle, and only then creates the GitHub Release. Do not create or
move release tags manually after a failed publication; fix the workflow and
rerun it against the same immutable tag.

Release images use `vX.Y.Z`, `X.Y.Z`, and `sha-<commit>` tags. The project does
not publish a `latest` image tag. Development snapshots continue to use
`main` and the full commit SHA.
