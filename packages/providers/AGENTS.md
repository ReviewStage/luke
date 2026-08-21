## Provider capability documentation

The code cannot state a provider's capability surface in one place. An adapter
has a capability exactly when it overrides the method, so the truth is spread
across every adapter, and nothing writes it down in full. Two documents
describe it in outline: the README's agent table, which names the providers,
and `PRIVACY.md`, which says what kind of data each connection reads and
writes.

**Add or remove the README's table row in the same change as a provider.**
Update `PRIVACY.md` when a change alters what kind of data leaves the machine
or which third party receives it, rather than for every capability that moves.

No lever enforces this. A capability the documents do not describe is one a
reader will not know Luke has, and a stale entry describes a Luke that does not
exist, so the rule is the whole guard.
