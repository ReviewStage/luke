/**
 * account.ts -- `vespin login`, `logout`, and `whoami`: the member signed in to a service, out of it, and who that is.
 *
 * `login` runs the desktop's own consent trip under the CLI's client id
 * (`@repo/credentials/cli`): the loopback, which opens the browser here
 * and listens for its redirect, or with `--no-browser` the paste-back,
 * which prints the page's address for a browser anywhere and reads back the
 * address it ended on. `logout` revokes the refresh token and clears the
 * store. `whoami` reads the account at userinfo and its workspaces through
 * `workspaces.list`, the one plain read of them the OAuth bearer reaches.
 */

import { pasteBackConsent } from "@repo/credentials";
import { type CliAccountFailed, cliIdentity, cliSignIn, cliSignOut } from "@repo/credentials/cli";
import { loopbackConsent } from "@repo/credentials/node";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Effect, type Stdio, type Terminal } from "effect";
import { Command, Flag } from "effect/cli";
import { openInBrowser } from "../browser.js";
import { answer, CommandFailed, note, readLine } from "../output.js";
import {
  accountBaseUrl,
  accountClient,
  askService,
  CREDENTIAL_SOURCE,
  serviceOrigin,
  session,
  storeFor,
} from "../session.js";

/** What a person at a terminal is told to paste back, and asked for it with. */
const PASTE_BACK = {
  SHOW: `Open this address in a browser, sign in to ${PRODUCT_NAME}, and copy the address the browser ends on (it will not load):`,
  PROMPT: "Paste that address here:",
} as const;

function commandFailed(failed: CliAccountFailed): CommandFailed {
  return new CommandFailed({ exit: failed.exit, message: failed.message });
}

/** Writes a line on stderr from inside a consent trip, whose page opener is not an effect. */
function shown(line: string): void {
  process.stderr.write(`${line}\n`);
}

const loginCommand = Command.make(
  "login",
  {
    noBrowser: Flag.Boolean("no-browser").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Print the sign-in address instead of opening a browser, and read back the address it ends on",
      ),
    ),
  },
  ({ noBrowser }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const origin = yield* serviceOrigin;
        // Note that the paste is read inside the trip, so it is handed the terminal's services here.
        const terminal = yield* Effect.context<Stdio.Stdio | Terminal.Terminal>();
        const pasted = Effect.provideContext(readLine(PASTE_BACK.PROMPT), terminal);
        const identity = yield* cliSignIn({
          client: accountClient(origin),
          accountBaseUrl: accountBaseUrl(origin),
          store: yield* storeFor(origin),
          openConsent: noBrowser ? pasteBackConsent(pasted) : loopbackConsent,
          openExternal: noBrowser
            ? (url) => shown(`${PASTE_BACK.SHOW}\n\n  ${url}\n`)
            : (url) => {
                shown(
                  `Opening ${PRODUCT_NAME} in your browser. If it does not open, visit:\n\n  ${url}\n`,
                );
                openInBrowser(url);
              },
        }).pipe(Effect.mapError(commandFailed));
        yield* answer({
          json: { origin, ...identity },
          lines: [`Signed in to ${origin} as ${identity.email}.`],
          ids: [identity.id ?? identity.email],
        });
      }),
    ),
).pipe(
  Command.withDescription(`Sign in to ${PRODUCT_NAME} in your browser`),
  Command.withExamples([
    { command: "vespin login", description: "Sign in through this machine's browser" },
    {
      command: "vespin login --no-browser",
      description: "Sign in over SSH, with a browser on another machine",
    },
  ]),
);

const logoutCommand = Command.make("logout", {}, () =>
  Effect.gen(function* () {
    const origin = yield* serviceOrigin;
    const ended = yield* cliSignOut(yield* storeFor(origin), accountClient(origin)).pipe(
      Effect.mapError(commandFailed),
    );
    const { source } = yield* session;
    if (source === CREDENTIAL_SOURCE.ENVIRONMENT) {
      yield* note("VESPIN_TOKEN is still set, and commands keep using it until it is unset.");
    }
    const line = !ended.signedIn
      ? `Not signed in to ${origin}.`
      : ended.revoked
        ? `Signed out of ${origin}.`
        : `Signed out of ${origin} on this machine. ${PRODUCT_NAME} could not be reached to revoke the sign-in, so it lapses on its own.`;
    yield* answer({ json: { origin, ...ended }, lines: [line] });
  }),
).pipe(
  Command.withDescription("Sign out: revoke this machine's sign-in and forget it"),
  Command.withExamples([{ command: "vespin logout", description: `Sign out of ${PRODUCT_NAME}` }]),
);

const whoamiCommand = Command.make("whoami", {}, () =>
  Effect.gen(function* () {
    const { origin, credential, source, hosted } = yield* session;
    const identity = yield* cliIdentity(accountBaseUrl(origin), credential).pipe(
      Effect.mapError(commandFailed),
    );
    const { workspaces } = yield* askService(hosted.workspaces.list, undefined);
    const listed = workspaces.map(({ id, name, slug, role }) => ({ id, name, slug, role }));
    yield* answer({
      json: { origin, source, ...identity, workspaces: listed },
      lines: [
        `${identity.name === undefined ? identity.email : `${identity.name} <${identity.email}>`} on ${origin}`,
        ...(source === CREDENTIAL_SOURCE.ENVIRONMENT ? ["Signed in with VESPIN_TOKEN."] : []),
        "",
        "Workspaces:",
        ...listed.map(({ name, slug, role }) => `  ${slug ?? name}  ${name} (${role})`),
      ],
      ids: [identity.id ?? identity.email],
    });
  }),
).pipe(
  Command.withDescription("Show who is signed in, and their workspaces"),
  Command.withExamples([
    { command: "vespin whoami", description: "Show the signed-in member" },
    { command: "vespin whoami --json", description: "The same, as JSON for a script" },
  ]),
);

/** The account group: sign in, sign out, and who is signed in. */
export const ACCOUNT_COMMANDS = [loginCommand, logoutCommand, whoamiCommand] as const;
