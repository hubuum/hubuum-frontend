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
  build manifests and App Router client-reference manifests, including shared
  application files; and
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
  "maxChunkGzipBytes": 160000,
  "maxRouteGzipBytes": 470000,
  "maxTotalGzipBytes": 1250000
}
```

The initial production baseline measured approximately:

- 133 KiB for the largest compressed chunk;
- 414 KiB for the largest initial route bundle; and
- 1.04 MiB for all static JavaScript.

The original limits retained roughly ten to seventeen percent headroom for
build variation. After adding credential introspection and large-graph controls,
the combined build measures 1,206,471 bytes of compressed static JavaScript,
compared with 1,198,760 bytes before the graph changes. Loading the graph's shared
configuration helper asynchronously removes 8,168 bytes from the first combined
implementation. The 1,250,000-byte total limit leaves about 3.6 percent headroom
for this measured baseline. The individual chunk and route limits are unchanged.

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
de-duplication, exercise Pages and Turbopack App Router discovery, cover every
budget class, and reject malformed configuration.

## Alternate output paths

The checker normally reads `.next` and `performance-budgets.json`. Diagnostic
or packaging workflows can override those paths:

```sh
PERFORMANCE_BUILD_DIR=/tmp/frontend-build \
PERFORMANCE_BUDGET_CONFIG=/tmp/budgets.json \
  npm run perf:budget
```
