# Releasing Hubuum Frontend

Hubuum Frontend releases publish a multi-architecture image, an OCI Helm chart,
a digest-pinned Compose quickstart, checksums, and a GitHub Release.

## Prepare

1. Update `package.json`, `package-lock.json`, the Helm chart, Compose defaults,
   and `CHANGELOG.md` to the same release version.
2. Merge the release changes to `main` through a pull request.
3. Wait for the required `validate`, `backend-contract`, `browser-quality`,
   `authenticated-browser-smoke`, `package`, and `publish-main` checks to
   pass on the exact `main` commit. The publisher builds AMD64 and ARM64
   images on matching native GitHub-hosted runners, assembles the
   multi-architecture manifest, and then publishes its attestation and
   development chart.
4. Check out that clean commit and run:

   ```sh
   bash scripts/check-release-readiness.sh v0.0.13
   ```

## Publish

Create and push an annotated tag from the verified commit:

```sh
git tag -a v0.0.13 -m "Hubuum Frontend v0.0.13"
git push origin v0.0.13
```

The tag workflow verifies that the commit passed CI on `main`, builds AMD64
and ARM64 images on matching native runners, assembles and attests the release
manifest, publishes the chart and quickstart bundle, and only then creates the
GitHub Release. Do not create or move release tags manually after a failed
publication; fix the workflow and rerun it against the same immutable tag.

Release images use `vX.Y.Z`, `X.Y.Z`, and `sha-<commit>` tags. The project does
not publish a `latest` image tag. Development snapshots continue to use
`main` and the full commit SHA.
