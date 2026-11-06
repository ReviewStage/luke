import os from "node:os";
import path from "node:path";
import { CLI_EXIT } from "@repo/features/cli-exit";
import {
  CURSOR_CONFIG_PATH,
  cursorConfigSnippet,
  cursorConfigWithServer,
  MCP_ADD_COMMAND,
  MCP_COMMAND_AGENT,
  MCP_SERVER_NAME,
  type McpCommand,
  type McpCommandAgent,
  mcpServerUrl,
  shellLine,
} from "@repo/features/mcp-connect";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Effect, FileSystem } from "effect";
import { Argument, Command } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { answer, CommandFailed, note } from "../output.js";
import { serviceOrigin } from "../session.js";

const MCP_CLIENT = {
  CLAUDE_CODE: "claude-code",
  CODEX: "codex",
  CURSOR: "cursor",
  VS_CODE: "vscode",
} as const;

type McpClientName = (typeof MCP_CLIENT)[keyof typeof MCP_CLIENT];

const COMMAND_AGENT_OF = {
  [MCP_CLIENT.CLAUDE_CODE]: MCP_COMMAND_AGENT.CLAUDE_CODE,
  [MCP_CLIENT.CODEX]: MCP_COMMAND_AGENT.CODEX,
  [MCP_CLIENT.VS_CODE]: MCP_COMMAND_AGENT.VS_CODE,
} as const satisfies Record<Exclude<McpClientName, typeof MCP_CLIENT.CURSOR>, McpCommandAgent>;

const SIGN_IN_NEXT = {
  [MCP_CLIENT.CLAUDE_CODE]: `Then type /mcp in Claude Code, choose ${MCP_SERVER_NAME}, and sign in.`,
  [MCP_CLIENT.CODEX]: `If your browser did not open to sign in, run codex mcp login ${MCP_SERVER_NAME}.`,
  [MCP_CLIENT.CURSOR]: `Then sign in to ${MCP_SERVER_NAME} from Cursor's MCP settings.`,
  [MCP_CLIENT.VS_CODE]: `Then start ${MCP_SERVER_NAME} from VS Code's MCP servers and sign in.`,
} as const satisfies Record<McpClientName, string>;

const CONNECTED = {
  RAN: "ran",
  WROTE: "wrote",
} as const;

function connectByHand(why: string, byHand: string): Effect.Effect<never, CommandFailed> {
  return Effect.andThen(
    note(`${why} Run or paste this yourself:\n\n${byHand}\n`),
    Effect.fail(new CommandFailed({ exit: CLI_EXIT.REFUSED, message: "Nothing was connected." })),
  );
}

const ran = Effect.fnUntraced(function* (command: McpCommand) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const [program, ...args] = command;
  return yield* spawner
    .exitCode(
      ChildProcess.make(program, args, { stdin: "ignore", stdout: "ignore", stderr: "inherit" }),
    )
    .pipe(
      Effect.map(Number),
      Effect.orElseSucceed(() => undefined),
    );
});

const installByCommand = Effect.fnUntraced(function* (
  client: keyof typeof COMMAND_AGENT_OF,
  serverUrl: string,
) {
  const command = MCP_ADD_COMMAND[COMMAND_AGENT_OF[client]](serverUrl);
  const exit = yield* ran(command);
  if (exit === undefined)
    return yield* connectByHand(`${command[0]} is not on your PATH.`, shellLine(command));
  if (exit !== 0) {
    return yield* new CommandFailed({
      exit: CLI_EXIT.REFUSED,
      message: `${shellLine(command)} ended with ${exit}.`,
    });
  }
  return { connected: CONNECTED.RAN, command: shellLine(command) };
});

const installInCursor = Effect.fnUntraced(function* (serverUrl: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const file = path.join(os.homedir(), ...CURSOR_CONFIG_PATH);
  const byHand = connectByHand(
    `${file} could not be read as Cursor's config.`,
    cursorConfigSnippet(serverUrl),
  );
  const exists = yield* Effect.orElseSucceed(fileSystem.exists(file), () => false);
  const text = exists
    ? yield* Effect.orElseSucceed(fileSystem.readFileString(file), () => undefined)
    : "";
  if (text === undefined) return yield* byHand;
  let config: unknown;
  try {
    config = text.trim() === "" ? undefined : JSON.parse(text);
  } catch {
    return yield* byHand;
  }
  const merged = cursorConfigWithServer(config, serverUrl);
  if (merged === undefined) return yield* byHand;
  const wrote = Effect.gen(function* () {
    yield* fileSystem.makeDirectory(path.dirname(file), { recursive: true });
    yield* fileSystem.writeFileString(file, `${JSON.stringify(merged, null, 2)}\n`);
  });
  yield* Effect.catch(wrote, () => byHand);
  return { connected: CONNECTED.WROTE, file };
});

const installCommand = Command.make(
  "install",
  {
    client: Argument.Literals("client", Object.values(MCP_CLIENT)).pipe(
      Argument.withDescription(
        "The coding agent to connect: claude-code, codex, cursor, or vscode",
      ),
    ),
  },
  ({ client }) =>
    Effect.gen(function* () {
      const serverUrl = mcpServerUrl(yield* serviceOrigin);
      const done =
        client === MCP_CLIENT.CURSOR
          ? yield* installInCursor(serverUrl)
          : yield* installByCommand(client, serverUrl);
      yield* note(SIGN_IN_NEXT[client]);
      yield* answer({
        json: { client, serverUrl, ...done },
        lines: [`Connected ${client} to ${PRODUCT_NAME}'s MCP server at ${serverUrl}.`],
        ids: [serverUrl],
      });
    }),
).pipe(
  Command.withDescription(`Connect a coding agent to ${PRODUCT_NAME}'s MCP server`),
  Command.withExamples([
    { command: "vespin mcp install claude-code", description: "Add the server to Claude Code" },
    { command: "vespin mcp install cursor", description: "Add it to ~/.cursor/mcp.json" },
  ]),
);

export const mcpCommand = Command.make("mcp").pipe(
  Command.withDescription(`Connect coding agents to ${PRODUCT_NAME}'s MCP server`),
  Command.withSubcommands([installCommand]),
  Command.withExamples([
    { command: "vespin mcp install codex", description: "Add the server to Codex" },
  ]),
);
