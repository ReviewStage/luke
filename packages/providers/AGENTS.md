## Provider capability documentation

`docs/PROVIDERS.md` is the one place the per-provider capability surface is written
down for a reader: what each provider connection observes, what a session row
can say, and which acts each provider takes. The code cannot state that in one
place — an adapter has a capability exactly when it overrides the method, so
the truth is spread across every adapter — which is why the document exists,
and why it can drift.

**When you change what a provider can do, update `docs/PROVIDERS.md` in the same
change.** That means adding or removing a provider or tracker, widening or
narrowing what an adapter observes, adding or dropping a control, a message
path, a workspace act, a recap source, or a hook, or changing how a credential
connects. The levers that exist are narrow: `scripts/provider-docs.test.mjs`
refuses a provider or tracker id the document does not name, and
`scripts/repository-checks.sh` requires the file to exist. Everything subtler
— a stale endpoint, a control the document still claims, a boundary the code
no longer keeps — has no lever, so the rule is stated here: a capability the
document does not describe is one a reader will not know Luke has, and a stale
entry describes a Luke that does not exist. `PRIVACY.md` and the README's
integration table cover the same connections at different altitudes; a change
that touches one usually touches all three. `PRIVACY.md`'s product-analytics
section is bound the same way and by nothing but this rule: it names every
event and every property by name, so an event added, renamed, or given a wider
value set leaves that document describing a Luke that no longer exists.
