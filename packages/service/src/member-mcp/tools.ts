/**
 * tools.ts -- the tools the member MCP server offers an outside agent acting for a member: each by its name, what it tells the agent, its input, and the effect it runs.
 *
 * A tool is declared once here and registered with the SDK by `server.ts`,
 * which runs its effect through the one promise door. Its input is a wire
 * schema: the node a model is shown is wire's own emission, recorded as a
 * golden under `fixtures/json-schema/`, and the SDK is handed the same
 * declaration as a Standard Schema (`standardSchemaOf`), so a call's
 * arguments are checked against what the model was shown. Its effect reads
 * the admitted member from the `AdmittedMember` service (`admission.ts`)
 * and answers the tool's result, which the agent reads as JSON text; a
 * store it could not read fails the effect, which the door answers as the
 * tool's own error.
 *
 * To add a tool, declare it with `memberMcpTool` and list it in
 * `MEMBER_MCP_TOOLS`; its golden is settled by `app.test.ts`.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { listWorkspaces } from "@repo/database/models/workspace-store";
import { type StandardSchemaWithJson, standardSchemaOf } from "@repo/wire/effect";
import { Effect, Schema } from "effect";
import type { StoreFailure } from "../http/store-failure.js";
import { AdmittedMember } from "./admission.js";

/** What a tool's effect runs against: the store, and the member the call acts for. */
export type MemberMcpServices = DatabaseServices | AdmittedMember;

/** A tool's input declaration: a wire schema the emitter can show and the reader can read. */
export type MemberMcpToolInput = Schema.Top & Schema.ConstraintDecoder<unknown>;

/** What a tool answers: a record the agent reads as JSON. */
export type MemberMcpToolResult = object;

export interface MemberMcpTool<Input extends MemberMcpToolInput = MemberMcpToolInput> {
  readonly name: string;
  /** What the agent is told of the tool, written for one acting for the member. */
  readonly description: string;
  readonly input: Input;
  /** The input as the SDK takes it, built once from `input`. */
  readonly inputSchema: StandardSchemaWithJson<Input>;
  /** The tool's work, on the arguments the SDK checked against `input`. */
  run(input: Input["Type"]): Effect.Effect<MemberMcpToolResult, StoreFailure, MemberMcpServices>;
}

/** A tool's declaration, its SDK input built beside it. */
function memberMcpTool<Input extends MemberMcpToolInput>(
  tool: Omit<MemberMcpTool<Input>, "inputSchema">,
): MemberMcpTool<Input> {
  return { ...tool, inputSchema: standardSchemaOf(tool.input) };
}

/** `list_workspaces` takes nothing: the member's workspaces are the member's. */
const NoInputSchema = Schema.Struct({});

export const LIST_WORKSPACES_TOOL = memberMcpTool({
  name: "list_workspaces",
  description:
    "List the workspaces the member you act for belongs to: each with its id, which every task and agent of it names, its slug, the first step of its links, its name, and the member's role in it (owner, admin, or member). Call it first to learn which workspace to work in.",
  input: NoInputSchema,
  run: () =>
    Effect.gen(function* () {
      const member = yield* AdmittedMember;
      const workspaces = yield* listWorkspaces(member.userId);
      return {
        workspaces: workspaces.map(({ id, slug, name, role }) => ({ id, slug, name, role })),
      };
    }),
});

/** Every tool the server offers, listed in the order an agent reads them. */
export const MEMBER_MCP_TOOLS: readonly MemberMcpTool[] = [LIST_WORKSPACES_TOOL];
