# `@sidecar/hosted`

This package is the desktop-to-service wire boundary. It owns the hosted
service client and the realtime credential contract, and depends only on lower
wire/session vocabulary. Behavior belongs above it: attention parsing lives in
`@sidecar/session`, the hosted attention evaluator lives in `@sidecar/voice`,
and realtime credential lifecycle depends on this package rather than being
imported by it.
