/**
 * workspace.ts -- `vespin workspace list` and `use`: the member's workspaces, and the one a command acts in where nothing else names one.
 *
 * `list` reads them through `workspaces.list` and marks the default the
 * config keeps for the service. `use` takes a slug, a slug the workspace
 * stood under before, or an id, checks it is one of the member's, and keeps
 * the workspace's id as the default (`keepWorkspace`), so a later change of
 * slug still names it. `-w` and `VESPIN_WORKSPACE` stand over it
 * (`../workspace.js`).
 */

import { CLI_EXIT } from "@repo/features/cli-exit";
import { workspaceOfSlug } from "@repo/features/workspace-wire";
import { Effect } from "effect";
import { Argument, Command } from "effect/cli";
import { configuredWorkspace, keepWorkspace } from "../config-store.js";
import { answer, CommandFailed } from "../output.js";
import { askService, session } from "../session.js";

/** A config file this version could not read or write, as the command's failure. */
function configFailed(failed: { readonly message: string }): CommandFailed {
  return new CommandFailed({ exit: CLI_EXIT.REFUSED, message: failed.message });
}

/** The member's workspaces on the service this run calls, and the one the config keeps as the default, where it names one of them. */
const workspacesRead = Effect.gen(function* () {
  const { origin, hosted } = yield* session;
  const { workspaces } = yield* askService(hosted.workspaces.list, undefined);
  const kept = yield* Effect.mapError(configuredWorkspace(origin), configFailed);
  const fallback = kept === undefined ? undefined : workspaceOfSlug(workspaces, kept);
  return { origin, workspaces, defaultId: fallback?.id };
});

const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const { workspaces, defaultId } = yield* workspacesRead;
    const listed = workspaces.map(({ id, slug, name, role }) => ({
      id,
      slug,
      name,
      role,
      default: id === defaultId,
    }));
    yield* answer({
      json: { workspaces: listed },
      lines: listed.map(
        (each) =>
          `${each.default ? "*" : " "} ${each.slug ?? each.id}  ${each.name} (${each.role})`,
      ),
      ids: listed.map(({ id }) => id),
    });
  }),
).pipe(
  Command.withDescription("List your workspaces, the default marked *"),
  Command.withExamples([
    { command: "vespin workspace list", description: "Your workspaces" },
    { command: "vespin workspace list -q", description: "Their ids alone" },
  ]),
);

const useCommand = Command.make(
  "use",
  {
    workspace: Argument.String("workspace").pipe(
      Argument.withDescription("The workspace's slug or id"),
    ),
  },
  ({ workspace }) =>
    Effect.gen(function* () {
      const { origin, workspaces } = yield* workspacesRead;
      const chosen = workspaceOfSlug(workspaces, workspace);
      if (chosen === undefined) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: [
            `${workspace} is none of your workspaces. Your workspaces:`,
            ...workspaces.map(({ id, slug, name }) => `  ${slug ?? id}  ${name}`),
          ].join("\n"),
        });
      }
      yield* Effect.mapError(keepWorkspace(origin, chosen.id), configFailed);
      yield* answer({
        json: { origin, workspace: { id: chosen.id, slug: chosen.slug, name: chosen.name } },
        lines: [`Commands now act in ${chosen.name} (${chosen.slug ?? chosen.id}) on ${origin}.`],
        ids: [chosen.id],
      });
    }),
).pipe(
  Command.withDescription("Keep a workspace as the default for commands on this service"),
  Command.withExamples([
    { command: "vespin workspace use acme", description: "Act in the acme workspace from now on" },
  ]),
);

export const workspaceCommand = Command.make("workspace").pipe(
  Command.withDescription("List your workspaces, and choose the default one"),
  Command.withSubcommands([listCommand, useCommand]),
  Command.withExamples([
    { command: "vespin workspace use acme", description: "Make acme the default workspace" },
  ]),
);
