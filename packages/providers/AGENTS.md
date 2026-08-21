## Provider capability documentation

The code cannot state a provider's capability surface in one place. An adapter
has a capability exactly when it overrides the method, so the truth is spread
across every adapter, and two documents describe it for a reader instead:
`PRIVACY.md`, which is authoritative, and the README's agent table, which is
the short version.

**When you change what a provider can do, update `PRIVACY.md` in the same
change.** That means adding or removing a provider or tracker, widening or
narrowing what an adapter observes, adding or dropping a control, a message
path, a workspace act, a recap source, or a hook, or changing how a credential
connects. Add or remove the row in the README's table in the same change when
the set of providers itself moves.

No lever enforces this. A capability the documents do not describe is one a
reader will not know Luke has, and a stale entry describes a Luke that does not
exist, so the rule is the whole guard. `PRIVACY.md`'s product-analytics section
is bound the same way and by nothing but this rule: it names every event and
every property by name, so an event added, renamed, or given a wider value set
leaves that document describing a Luke that no longer exists.
