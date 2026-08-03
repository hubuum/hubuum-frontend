# Frontend performance budgets

Hubuum Frontend checks compressed JavaScript budgets after every production
`next build` in CI.

Run the same check locally with:

```sh
npm run build
npm run perf:budget
```

The budget checker reads `performance-budgets.json` and measures the generated
files under `.next/static`. Gzip level 9 is used consistently for comparison.
It enforces three complementary limits:

- **largest chunk** — catches an unexpectedly large code-split asset, including
  accidentally eager specialist dependencies;
- **largest initial route bundle** — combines the JavaScript named by Next.js
  build manifests, including shared application files; and
- **total static JavaScript** — catches broad dependency or duplication growth,
  even when individual routes remain below their limits.

The CI step writes the largest chunks and route bundles to the GitHub Actions
step summary. A failure identifies every asset or route over budget rather than
stopping at the first violation.

## Configuration

`performance-budgets.json` is deliberately small and reviewable:

```json
{
  "version": 1,
  "maxChunkGzipBytes": 700000,
  "maxRouteGzipBytes": 850000,
  "maxTotalGzipBytes": 4000000
}
```

Budget changes should be intentional. Prefer reducing or lazy-loading the
regression. When a product requirement genuinely increases the baseline,
include the measured before/after values and the reason in the pull request
that changes the limit.

## Tool validation

The manifest and budget logic has a dependency-free Node test suite:

```sh
npm run test:performance-budget
```

The tests build representative `.next` fixtures, verify shared-file
de-duplication, exercise every budget class, and reject malformed
configuration.

## Alternate output paths

The checker normally reads `.next` and `performance-budgets.json`. Diagnostic
or packaging workflows can override those paths:

```sh
PERFORMANCE_BUILD_DIR=/tmp/frontend-build \
PERFORMANCE_BUDGET_CONFIG=/tmp/budgets.json \
  npm run perf:budget
```
