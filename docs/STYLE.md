# Style

How this repository is designed and written. The model is Redis, taken
from three sources: the Redis Manifesto, antirez's essays "Writing
system software: code comments" (antirez.com/news/124) and "We are
destroying software" (antirez.com/news/145), and the conventions the source
itself follows in every file. Each rule is quoted or cited from one of
those. Where the C habit does not carry straight into TypeScript, the
translation follows under "In TypeScript". Comments are where we part from
Redis on purpose: Part 3 says why.

Three parts: what we build, how a file is shaped, and where the words a
comment would hold go instead. Formatting the linter handles is not
repeated here.

## Part 1: Design

### Fight complexity by not creating it

Manifesto 6: "Most of the time the best way to fight complexity is by not
creating it at all." "We'll try hard to recognize when a small feature is
not worth 1000s of lines of code."

- Before adding, ask what can be sacrificed. antirez: the two drivers of
  complexity are "the unwillingness to perform design sacrifices and the
  accumulation of errors in the design activity."
- Solve 95% of the problem with 5% of the code when that is acceptable
  (Manifesto 10, "opportunistic programming").
- Refuse a feature, a layer, or an optimization that does not earn its
  lines. Say no in the PR, with the sacrifice named.

### One programmer must be able to hold it

Manifesto 6: "One of the main Redis goals is to remain understandable,
enough for a single programmer to have a clear idea of how it works in
detail just reading the source code for a couple of weeks."

- That is the budget. Every package, layer, and indirection spends it.
- An interface, a layer, or a generic exists on the second implementation,
  not the first. A named function for one caller is not an abstraction; see
  "Shape a function".

### Keep the surface small

"We are destroying software" 3, 2, 8: "...with an absurd chain of
dependencies, making everything bloated and fragile." "...with complex build
systems." "...by always underestimating how hard it is to work with existing
complex libraries VS creating our stuff."

- Every dependency and build step earns its place by capability the team
  could not reasonably write, and is listed with its reason and its upgrade
  procedure, as `deps/README.md` does for Redis's eight vendored libraries.
- Prefer writing a small thing to importing a large one. "Don't reinvent the
  wheel" is not a law here.
- One framework at most. Effect is that framework. No second framework
  sits on top of it.
- A new dependency is a design decision stated in the PR, not a line in a
  lockfile.
- Generated code comes from one data file through one generator, opens
  with a banner saying so, and there is nothing else generated. Redis generates
  exactly one file, `commands.def`, from the JSON describing each command.

### Fundamental structures, no intermediate layers

Manifesto 3: "Redis will avoid intermediate layers in API, so that the
complexity is obvious and more complex operations can be performed as the
sum of the basic operations." Manifesto 4: "just the layers of abstractions
that are really needed."

- Design from the data structure outward. Choose the representation first,
  then let the operations follow from it.
- Expose the basic operations. Do not wrap them in a convenience layer that
  hides their cost.
- An interface with one implementation, a type for one field, a wrapper
  that adds no fact to the call it wraps: each is a layer with no reason.
  Redis's thin wrappers each add one fact, a default, a unit, a checked
  precondition.
- A shape that carries the product's core state (a roster, a conversation,
  a session) is defined in one place, and its package's README gives the
  reason for its shape and names the function that maintains each
  invariant. Redis hand-writes `sds`, `dict`, and `rax`, and each header
  opens with that essay; `rax.h` draws the tree.

### Do not rewrite what works, do not break what is used

"We are destroying software" 6, 5: "...pushing for rewrites of things that
work." "...by no longer caring about backward APIs compatibility."

- Refine in place. antirez rewrites a function after it works, to express
  the shape of the problem more directly, and keeps its contract.
- A wire shape, a stored row, a public function's meaning: once shipped,
  changed only with a migration and a reason.
- A style pass is not a rewrite. It changes names and shape, never
  behavior, and is reviewed as such.

### Simple things must stay simple

"We are destroying software" 12: "...by making systems that no longer
scale down." Simple things should be simple to accomplish, in any system.

- Running, testing, and reading one package must not require the whole
  system. A test that needs the database, the runtime, and a fixture
  server to check a pure function is a design failure.
- The common case is the short path. Configuration, flags, and layers exist
  for the uncommon case and are absent from the common one.

## Part 2: Code shape

### Order a file for reading

Every Redis file follows one order, so a reader knows where to look before
opening it. `t_zset.c`: license, purpose line, design comment, includes,
constants and tables, forward declarations, private helpers, public API,
and the command handlers last, at line 3514 of 4824.

- The file's name says what it holds. Its first line is its first import.
- Then constants and schemas, private helpers, the public functions, and
  the entry points (route handlers, IPC handlers, React components) last.
- Definitions before use. A forward reference gets a declaration, not a
  reordering that breaks the reading order.
- Where Redis would draw a divider between the sections of a long file,
  each section is a module of its own, named for what it holds.
- Fields before methods in a class.

### Name by layer, then verb

Redis names every function `<layer><Verb><Qualifier>`: `zslInsert`,
`zzlFind`, `zsetConvert`, three prefixes in one file because the file holds
three layers. Every command handler is `<command>Command`, uniform across
465 commands. C has no modules, so the layer is spelled into the name.

- In TypeScript the module is the prefix. One module per layer, and its
  exports are `<Verb><Qualifier>` without repeating the module's name:
  `skiplist.insert`, not `skiplistInsert` inside `skiplist.ts`.
- Every entry point of one kind has the same shape of name. Route handlers,
  agent tools, IPC handlers: each family has one pattern and no exceptions.
- Public versus private is signaled by `export` and nothing else. No
  underscore, no `internal` suffix, no naming marker.
- Short names where the type is obvious from context: Redis uses `c` for
  the client, `o` for the object, `x` for the cursor, `de` for the dict
  entry, in every function. A long name is for a thing whose type does not
  say what it is.
- Constants are `SCREAMING_SNAKE_CASE` with a domain prefix: `C_OK`,
  `OBJ_ZSET`, `ZSKIPLIST_MAXLEVEL`. This repository already requires the
  `as const` form in `AGENTS.md`.

### Shape a function the Redis way

The habits below are visible in any Redis command handler. `zaddGenericCommand`
in `t_zset.c` shows all of them in 135 lines.

- Guard early, then one exit. Redis handlers check every precondition
  first and leave through one path named for what it does: `cleanup`,
  `done`, `free_command`. In TypeScript: early returns for the guards, one
  `Scope` or one `finally` for the release.
- Subject first, spec second, out-params last:
  `zslNthInRange(zsl, range, n, out_rank)`. A destructive helper takes the
  owning container even when it could be derived, so it can keep counters
  honest: `zslFreeNode(zsl, node)`.
- Reply before returning the error. In a handler, the caller-facing message
  is sent, then `C_ERR` is returned. The two never separate. In TypeScript:
  the typed error a handler fails with carries the message the caller
  sees, so there is no second place that decides what to say.
- Extract a helper the moment a piece of logic has a name, even for one
  caller. `zslGetElementByRank` is a three-line wrapper; `zslAllocSize` is
  one line; `expireCommand` and its three siblings are thin wrappers over
  one generic implementation. Its name says what it does, and its parameter
  types or an assertion on entry say what it assumes: where Redis writes
  "rank argument needs to be 1-based" above the function, the parameter is
  a branded `OneBasedRank`.

### A function is read in one pass

Redis files are long. `server.c` is sixteen thousand lines. Redis functions
are not: the median is ten lines and nine in ten are under fifty. A reader
holds a whole function at once, which is what makes a bug visible. This is
the structural rule that matters most here, and the one most often broken.

- If a reader has to scroll and come back, extract the part they scrolled
  past. Files may be long. Functions may not.
- Control flow is `if`, `for`, `return`, `yield*`. Unroll nested
  combinators into a generator when the flow is the point.
- A closure over a mutable local of its enclosing function is a field of an
  object not yet written. Write the object.
- Anything that can end in more than two ways gets an explicit state and
  one transition function.
- A component is a function. A component that needs a twenty-entry
  dependency array is several components.

### Assert invariants, panic on the impossible

`t_zset.c` alone holds over thirty `serverAssert` calls: `serverAssert(!isnan(score))`,
`serverAssert(x->level[0].forward == node)`. Every `switch` on an encoding
ends in `serverPanic("Unknown sorted set encoding")`. Compile-time facts use
`static_assert` with a message.

- State an invariant where it holds, as an assertion, not as a comment.
- The default arm of every exhaustive match is a panic with the value in
  the message, never a silent fallthrough or a returned undefined.
- What the type system can prove, prove there. What it cannot, assert at
  runtime at the boundary where it becomes true.
- In TypeScript: an exhaustive `switch` ends in a `never` check that dies
  with the value; a runtime invariant is a Schema decode at the boundary or
  an explicit assertion, not a comment; a compile-time fact is a `satisfies`.
- A core structure has a verify function that checks each invariant and
  says which failed, as `zslDebugVerifyStruct` does; tests call it after
  every mutation. The running system can be asked what it holds, as
  Redis's `DEBUG` command allows.

### Test behavior as sentences, structure beside the code

Redis tests are black-box Tcl blocks against a live server, one per
command per scenario, named as a sentence: `INCR against non existing key`,
`ZADD with NaN score`. Structural tests live in the `.c` file under
`#ifdef REDIS_TEST`, beside the code they check.

- A behavioral test is named as a sentence: the subject, then the
  condition. A reader learns the contract from the test names alone.
- A test checks one observable outcome through the public surface, not the
  private steps.
- A test of an internal structure sits beside the structure.
- In TypeScript: `test("INCR against non existing key", ...)` reads the
  same way. Name the subject, then the condition, in words.

## Part 3: Comments

Here we part from Redis. antirez credits the readability of Redis to its
comments; this repository keeps none, because a comment is the one line
nothing checks. It goes stale the day the code under it changes, and
nothing fails when it does. A name, a type, an assertion, and a test break
the build instead.

### What each kind of comment becomes

antirez's essay names the kinds of comment a reader needs. Each has a place
in this repository that a tool keeps true.

- **Guide**, a line introducing the next few statements: a named function
  or a named constant. The step's name is the function's name, and the
  caller reads as a list of steps.
- **Why**, "Note that we X, because Y": a name that carries the reason
  (`unlinkWithoutScan`, `RETURN_PAGE_SURVIVES_RESTORE`), or the commit
  message of the change that made the choice, which `git blame` finds from
  the line.
- **Contract**, what a function assumes: a parameter type that cannot hold
  the wrong value (a branded `OneBasedRank`), or an assertion on entry.
- **Design and teacher**, an algorithm, a protocol, a state machine, a
  hazard, and its source: the package's `README.md`, under a heading named
  for the function or module, citing the paper, RFC, measurement, or
  incident. `packages/service/README.md` is the model.
- **Checklist**, "if you change this, also change that": an exhaustive
  `switch` ending in a `never` check, a shared `as const` table both sites
  read, a lint rule in `tools/anti-slop/`, or a test that fails when the two
  drift.
- **Trivial**, a restatement of the code: deleted.

### The comments a tool reads

A comment stays when a tool reads it and acts on it, since deleting it
changes what the build does:

- a shebang, a license header, and a generated file's banner;
- a lint or type suppression (`@ts-expect-error`, a lint directive), each
  where the lint rules allow one;
- a pragma: `@vitest-environment`, `/// <reference>`;
- a JSDoc tag a tool acts on: `@public` for knip, `@deprecated` for the
  editor.

Such a comment says only what its tool needs. Prose beside it is a comment
and goes where Part 3 sends it.
