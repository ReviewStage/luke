# vespin

[Vespin](https://vespin.dev) from your terminal: work with your tasks, plans,
and coding agents from a shell, as a person or as a coding agent calling it.

## Install

Run it once with npx, on Node 20 or later:

```sh
npx vespin --help
```

Install it with npm:

```sh
npm i -g vespin
```

Or install it with its own Node, on Linux (x64 or arm64) or an Apple silicon
Mac, into `~/.local/bin/vespin`:

```sh
curl -fsSL https://vespin.dev/install.sh | sh -s cli
```

## Sign in

```sh
vespin login
```

This opens your browser to sign in. On a machine with no browser, such as one
you reach over SSH, run `vespin login --no-browser` and paste back the address
your browser lands on. `vespin logout` signs you out, and you can revoke the
CLI at any time under Settings › Vespin MCP › Connected.

## Examples

```sh
vespin whoami                      # who is signed in, and their workspaces
vespin whoami --json               # the same, as JSON for a script
vespin api GET /api/workspaces     # call any procedure of the hosted API
vespin --help                      # every command, each with examples
```

Output is a table at a terminal and JSON when piped or with `--json`, and the
exit code says how a command ended: 0 ok, 1 refused, 2 usage, 3 sign-in,
4 network or server.

## Update

```sh
vespin update
```

A curl install updates itself in place. An npm install prints the command to
update it with, `npm i -g vespin@latest`. `vespin version` says which kind of
install you have.

## License

Apache-2.0. The notices of the packages bundled into `vespin.mjs` are in
`THIRD_PARTY_NOTICES`.
