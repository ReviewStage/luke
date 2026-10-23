/**
 * skill-audit.ts -- skills.sh's security ratings of a public repository's skills, asked as the `skills` tool asks them before it installs.
 *
 * A port of vercel-labs/skills at a80e4c9, `src/telemetry.ts`'s
 * `fetchAuditData`: one GET of `https://www.skills.sh/tele/audit` naming
 * the repository as `owner/repo` and the skills by name, answered with each
 * skill's ratings by partner. The caller asks only for a repository GitHub
 * says is public, as the tool asks only once GitHub confirmed one, so no
 * private repository's name or skills leave the service.
 *
 * The ratings are advisory. A request that fails, answers anything but a
 * 200, or is not answered in three seconds is no ratings, and nothing here
 * fails. A rating that does not read as the tool's `PartnerAudit` is
 * dropped, and a skill left with none is left out.
 */

import {
  type SkillPartnerAudit,
  skillPartnerAuditSchema,
} from "@luke/features/installed-skill-route-wire";
import { Duration, Effect, Option, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

/** The audit API the tool reads (`AUDIT_URL`). */
const AUDIT_URL = "https://www.skills.sh/tele/audit";

/** How long skills.sh is given to answer, the tool's own deadline. */
const AUDIT_TIMEOUT = Duration.seconds(3);

/** The answer as far as it is read: skills by name, each a record of partners whose ratings are read one by one. */
const AuditAnswerSchema = Schema.Record(
  Schema.String,
  Schema.Record(Schema.String, Schema.Unknown),
);

const readAnswer = Schema.decodeUnknownOption(AuditAnswerSchema);
const readRating = Schema.decodeUnknownOption(skillPartnerAuditSchema);

/** Each skill's ratings by partner, for the skills skills.sh rated. */
export type SkillAudits = ReadonlyMap<string, Readonly<Record<string, SkillPartnerAudit>>>;

/** The ratings of one skill that read, by partner; none where none does. */
function ratingsOf(
  partners: Readonly<Record<string, unknown>>,
): Record<string, SkillPartnerAudit> | undefined {
  const read = Object.entries(partners).flatMap(([partner, rating]) =>
    Option.match(readRating(rating), {
      onNone: () => [],
      onSome: (audit) => [[partner, audit] as const],
    }),
  );
  return read.length === 0 ? undefined : Object.fromEntries(read);
}

/**
 * skills.sh's ratings of the skills named in the repository named
 * `owner/repo`, as the module's header says; empty for no names, and
 * empty for any failure.
 */
export const skillAudits = /* @__PURE__ */ Effect.fnUntraced(function* (
  source: string,
  names: readonly string[],
): Effect.fn.Return<SkillAudits, never, HttpClient.HttpClient> {
  if (names.length === 0) return new Map();
  const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
  const request = HttpClientRequest.get(AUDIT_URL).pipe(
    HttpClientRequest.setUrlParams({ source, skills: names.join(",") }),
  );
  // Note that a failure's cause is dropped unread, since the ratings only ever add to a preview.
  const answered = Option.flatMap(
    yield* client.execute(request).pipe(
      Effect.flatMap((response) => response.json),
      Effect.scoped,
      Effect.timeout(AUDIT_TIMEOUT),
      Effect.option,
    ),
    readAnswer,
  );
  if (Option.isNone(answered)) return new Map();
  const asked = new Set(names);
  return new Map(
    Object.entries(answered.value).flatMap(([name, partners]) => {
      const ratings = asked.has(name) ? ratingsOf(partners) : undefined;
      return ratings === undefined ? [] : [[name, ratings] as const];
    }),
  );
});
