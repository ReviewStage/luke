import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import { credentialAsked, servedCredential } from "./pr-run-credential.js";

/**
 * The token a pull request is fetched with, served to a real Git through
 * the helper on a private socket: Git is handed it for the one repository,
 * over HTTPS on GitHub, and for nothing else, and the flags Git is run with
 * never carry it. Synthetic tokens throughout.
 */

const TOKEN = "ghs_fixture_pull_request_token";

/** What `git credential fill` answers for the request, under the flags given and no configuration from the machine. */
function credentialFill(flags: readonly string[], request: string) {
  return Effect.callback<string>((resume) => {
    const child = execFile(
      "git",
      [...flags, "credential", "fill"],
      {
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "",
        },
      },
      (_error, stdout) => resume(Effect.succeed(stdout)),
    );
    child.stdin?.end(request);
  });
}

const runtime = { path: process.execPath, environment: {} } as const;

it.effect(
  "Git is handed the token for the one repository over HTTPS on GitHub, and the flags never carry it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const flags = yield* servedCredential(runtime, "Octocat/Relay", Redacted.make(TOKEN));

        const answered = yield* credentialFill(
          flags,
          "protocol=https\nhost=github.com\npath=octocat/relay.git\n\n",
        );

        assert.match(answered, /^username=x-access-token$/mu);
        assert.match(answered, new RegExp(`^password=${TOKEN}$`, "mu"));
        assert.equal(flags.join(" ").includes(TOKEN), false);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("another repository, host, or protocol is handed no token", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const flags = yield* servedCredential(runtime, "octocat/relay", Redacted.make(TOKEN));

      for (const request of [
        "protocol=https\nhost=github.com\npath=octocat/other.git\n\n",
        "protocol=https\nhost=evil.example\npath=octocat/relay.git\n\n",
        "protocol=http\nhost=github.com\npath=octocat/relay.git\n\n",
      ]) {
        const answered = yield* credentialFill(flags, request);
        assert.equal(answered.includes(TOKEN), false, request);
      }
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("once the scope closes, the socket answers nothing", () =>
  Effect.gen(function* () {
    const flags = yield* Effect.scoped(
      servedCredential(runtime, "octocat/relay", Redacted.make(TOKEN)),
    );

    const answered = yield* credentialFill(
      flags,
      "protocol=https\nhost=github.com\npath=octocat/relay.git\n\n",
    );

    assert.equal(answered.includes(TOKEN), false);
  }).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a request is read as Git spells it, its host without case and nothing else loosened",
  () =>
    Effect.sync(() => {
      assert.equal(
        credentialAsked(
          "protocol=https\nhost=GitHub.com\npath=Octocat/Relay.git\n",
          "octocat/relay",
        ),
        true,
      );
      assert.equal(credentialAsked("protocol=https\nhost=github.com\n", "octocat/relay"), false);
      assert.equal(
        credentialAsked(
          "protocol=https\nhost=github.com.evil.example\npath=octocat/relay.git\n",
          "octocat/relay",
        ),
        false,
      );
    }),
);
