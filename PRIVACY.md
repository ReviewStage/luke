# Privacy

Luke v0.1 observes coding-agent sessions on your Mac. This document describes
the current implementation; it is not a promise about third-party services.

## What Luke reads locally

- For Claude Code, Luke finds recent session files, opens bounded tails
  read-only, and inspects them in memory.
- For Codex, Luke opens the local SQLite state database in read-only mode.

Luke extracts only the data needed to identify and display a session:
provider and session identifiers, the workspace folder basename, timestamps,
status, event type, and tool-use presence where applicable. Event type and
tool-use presence are used to derive status; transcript text is not retained.

Luke does not modify provider files, retain transcript text, inject input, or
require provider hooks or plugins. It does not control provider sessions.

## What stays local

The microphone is optional. When enabled, Luke uses it only to calculate audio
levels for a local visualization. Audio is not recorded, written to disk, sent
to an attention-review endpoint, or otherwise uploaded by Luke.

## Optional external attention review

Without `OPENAI_API_KEY`, Luke does not send an attention-review request.

With `OPENAI_API_KEY`, Luke sends the configured Responses-compatible endpoint
the provider name, workspace-derived title, previous and current status,
review trigger, and a bounded status summary. The request also includes fixed
review instructions and synthetic examples. The API key is sent to that
endpoint as the request's bearer credential.

Luke does not send provider transcripts, command output, file contents, full
filesystem paths, provider session identifiers, or locally observed timestamps
in that request.

Requests use `store: false`, which disables Responses application-state
storage. This does not mean zero retention: ordinary provider abuse-monitoring
retention may still apply according to the user's API provider and account
controls.

By default, requests go to OpenAI's API. If `OPENAI_BASE_URL` is changed, the
same attention-review data goes to that configured third-party endpoint and is
handled under that endpoint's policies. The bearer credential is also sent to
that endpoint.
