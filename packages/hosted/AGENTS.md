# `@sidecar/hosted`

## This sits above `attention` and `realtime`, not below

`hosted-service.ts` is the desktop↔service wire contract, so the shape of the
graph says it should be near the bottom. It is not: it imports `attention.js`
and `realtime-credentials.js`, which makes the wire contract depend on the
behaviour rather than the other way round.

The package graph makes that inversion visible in a `package.json` instead of
hiding it in an import line, which is the point of naming it here. Straightening
it is a separate design change and carries behaviour risk; until then, expect
this package to sit higher than its name suggests.

The hosted attention evaluator lives here for the same reason. It reads the
hosted service, and `@sidecar/attention` cannot depend on this package without
closing the loop, so the evaluator sits with the service it speaks to.
