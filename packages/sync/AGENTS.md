# `@repo/sync`

## It knows nothing of the rest of the repository

The engine names no entity kind, no Gateway method, no composer, and no
feature's wire. A kind (`EntityKind`) and a write (`WriteDeclaration`) are
declared by their client in the host, beside the composer that reads them, and
a read hands the pool its confirmation (`Confirmation`) rather than the pool
importing how a read follows. **Its only dependencies are `effect` and
`@tanstack/db`**, and the dependency graph is what holds that: reaching a
workspace package would take a new line in `package.json`.

## It stays free of Node

The web app runs the host in a tab, and the host draws every row it holds from
this pool, so nothing here names a `node:` module, `Buffer`, or `process`.
`scripts/repository-checks.sh` walks into this package from the host's
browser doors and fails on one.

## A pool collection is never a TanStack transaction

Each kind is one collection only sync writes. A write is laid over it by the
pool itself, never as an optimistic transaction, because a persisting
transaction holds back every answer its collection is synced, which would
freeze every read of the kind behind one write. Nothing here truncates either,
because a truncate deletes every row and inserts it again, moved or not.
