import { ISSUE_STATE, type IssueState } from "@repo/features/github-repositories-wire";
import { Effect, Option, type Redacted, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  GITHUB_HTTP_STATUS,
  type GitHubUnavailable,
  githubRead,
  readBody,
  send,
} from "./github-app.js";
import { GitHubOpenerSchema, openerFieldsOf } from "./pull-requests.js";

export interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: IssueState;
  readonly author?: string;
  readonly authorAvatarUrl?: string;
  readonly authorBot?: boolean;
}

const GITHUB_CLOSED = "closed";
const NOT_PLANNED_REASONS: ReadonlySet<string> = new Set(["not_planned", "duplicate"]);

const IssueSchema = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  html_url: Schema.String,
  state: Schema.String,
  state_reason: Schema.optional(Schema.NullOr(Schema.String)),
  user: Schema.optional(Schema.NullOr(GitHubOpenerSchema)),
  pull_request: Schema.optional(Schema.Unknown),
});

function stateOf(record: typeof IssueSchema.Type): IssueState {
  if (record.state !== GITHUB_CLOSED) return ISSUE_STATE.OPEN;
  return NOT_PLANNED_REASONS.has(record.state_reason ?? "")
    ? ISSUE_STATE.NOT_PLANNED
    : ISSUE_STATE.CLOSED;
}

export function issueByNumber(
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Effect.Effect<Option.Option<GitHubIssue>, GitHubUnavailable, HttpClient.HttpClient> {
  const [owner = "", name = ""] = fullName.split("/");
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}`;
  return Effect.scoped(
    Effect.flatMap(send(githubRead(path, token)), (response) => {
      if (
        response.status === GITHUB_HTTP_STATUS.NOT_FOUND ||
        response.status === GITHUB_HTTP_STATUS.GONE
      ) {
        return Effect.succeed(Option.none<GitHubIssue>());
      }
      return Effect.map(readBody(response, IssueSchema), (record) =>
        record.pull_request === undefined
          ? Option.some({
              number: record.number,
              title: record.title,
              url: record.html_url,
              state: stateOf(record),
              ...openerFieldsOf(record.user),
            })
          : Option.none(),
      );
    }),
  );
}
