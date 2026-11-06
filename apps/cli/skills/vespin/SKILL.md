---
name: vespin
description: Drive Vespin from a shell with the `vespin` command: create tasks, read and write their descriptions, start coding agents and wait on them, check out an agent's branch, and answer the inbox threads agents post. Load it when asked to work with Vespin tasks, their descriptions, agents, or inbox from a terminal, to script or pipe Vespin, or to wait on an agent and bring its branch local. Prefer Vespin's MCP server only when you have no shell.
---

# vespin

`vespin` is Vespin's command-line tool. It is never interactive when stdin is not a terminal, so you can run it from a shell tool.

## Setup

```sh
npx vespin login          # or: npm i -g vespin && vespin login
vespin whoami             # who is signed in, and their workspaces
vespin workspace use acme # default workspace; or -w acme / VESPIN_WORKSPACE per command
```

`login` opens a browser. Over SSH, or with no browser, run `vespin login --no-browser` and paste back the address the browser ends on; ask the person to do this, since only they can sign in. If `VESPIN_TOKEN` is set it is used first. Exit 3 means sign in again.

## Core loop

```sh
echo "Fix the login redirect" | vespin task create "Login redirect" --start --prompt -
vespin agent wait <agent-id> --timeout 1800   # exit code says how the turn ended
vespin agent checkout <agent-id>              # fetch its branch and check it out here
```

- `task create` takes the repository from this folder's `origin` (override with `-R owner/name`). With `-q` it prints the task id, then the agent id. `--start` hands the agent the description (`-F description.md`); `--prompt <file|->` hands it a prompt instead.
- To see the work live, use `vespin agent logs <id> --follow`. Without `--follow` it prints the transcript so far.
- `agent checkout` must run inside a clone of the task's repository. `agent view <id>` prints the branch, pull request, and checks.
- Tasks are named by id, number, or key (`ACME-42`). Agents and threads are named by id.

Other commands:

| Command | What it does |
| --- | --- |
| `task list [--mine] [--status s]` · `task view <task>` · `task update <task> [--status] [--priority] [--assignee] [--name]` | Find, read, and change tasks; `--status done` marks one done |
| `description show <task>` · `description edit <task> -F <file\|->` | Print the description as Markdown; replace it whole |
| `agent start <task> [-F prompt] [--model m --effort e] [--branch b] [--cloud\|--on <device>] [--follow\|--wait]` | Start an agent; `vespin models` lists `--model` and `--effort` values |
| `agent list [<task>] [--offset n]` · `agent view <id>` | Agents, newest first, the workspace's 50 a page (`--offset` the `nextOffset` it printed); one agent's status |
| `agent send <id> -F <msg\|->` · `agent stop <id>` | Message an agent; stop its turn (what it pushed stays) |
| `inbox list [--unread]` · `inbox view <thread>` | Threads agents posted, and one thread with its open ask |
| `inbox answer <thread> <option>` · `inbox answer <thread> -F <json\|->` · `inbox reply <thread> -F <msg\|->` · `inbox close <thread>` | Answer a decide's option, `done` for a to-do, or a form as JSON by field; write on the thread; close it |

`description edit` replaces the whole description, so run `description show` first and edit that; piped, `show` prints JSON, so take its `body` (`jq -r .body`). Run `vespin <group> --help` for any flag not listed here.

## Conventions

- **Output:** stdout is JSON when piped or captured (what you get from a shell tool), or with `--json`; `-q` prints ids only, one a line. Notes and errors go to stderr, so stdout is the answer alone.
- **Input:** `-F -` (or `--prompt -`) reads stdin; only one flag may read stdin per command. Pass text through a pipe or file, never as a long argument.
- **Exit codes:** 0 ok, 1 refused (missing task, bad input, a limit), 2 usage, 3 not signed in, 4 network or server error, 5 the agent's turn failed or was stopped, 6 `--timeout` passed with the turn still running. `agent wait` and `--wait` use 5 and 6; their JSON says which.
- **Never wait on a prompt:** every id is an explicit argument. If a command needs a person (sign-in, an answer only they can give), stop and ask them.

## Anything without a command

`vespin api <GET|POST|PUT|PATCH|DELETE> <path> [-F <json|->]` calls any hosted procedure and prints its JSON:

```sh
vespin api GET /api/workspaces
echo '{"name":"Research"}' | vespin api POST /api/workspaces -F -
```

## CLI or MCP

Use the CLI when you have a shell: scripting, piping and filtering output (`--json | jq`), waiting on an agent with `agent wait`, streaming with `agent logs --follow`, and checking out an agent's branch locally. It also knows your working folder's repository.

Use Vespin's MCP server when you have no shell, or can only call tools. `vespin mcp install claude-code|codex|cursor|vscode` connects an agent to it.

## Examples

Fan out two agents, wait on both, then check out the first:

```sh
a=$(echo "Add tests for the redirect" | vespin agent start ACME-42 -F - -q)
b=$(echo "Update the docs for the redirect" | vespin agent start ACME-42 -F - -q)
vespin agent wait "$a" && vespin agent wait "$b" && vespin agent checkout "$a"
```

Edit a description in a pipe:

```sh
vespin description show ACME-42 | jq -r .body | sed 's/- \[ \] Tests/- [x] Tests/' | vespin description edit ACME-42 -F -
```

Answer the first unread thread:

```sh
t=$(vespin inbox list --unread -q | head -1)
vespin inbox view "$t" --json     # read the ask
vespin inbox answer "$t" Approve
```

React to how a wait ended:

```sh
vespin agent wait "$id" --timeout 600; case $? in
  0) vespin agent checkout "$id" ;;
  5) vespin agent logs "$id" | tail -50 ;;
  6) vespin agent send "$id" -F - <<< "Status?" ;;
esac
```
