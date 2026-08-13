# Privacy

Luke v0.1 observes coding-agent sessions on your Mac. This document describes
the current implementation; it is not a promise about third-party services.

## What Luke reads locally

- For Claude Code, Luke finds recent session files, opens bounded tails
  read-only, and inspects them in memory.
- For Codex, Luke opens the local SQLite state database in read-only mode and
  reads the recent rollout logs named by its thread records.
- For OpenCode, Luke opens the local session database in read-only mode and
  reads session records plus the bookkeeping of a session's newest message and
  tool records — roles, timestamps, tool names and inputs, and recorded
  errors — not the message text, which is never opened. Installs from before
  OpenCode moved its sessions into that database are read from its session and
  message JSON files with the same boundary.
- For the Cursor agents running on this machine, Luke finds recent transcripts,
  opens bounded tails read-only, and reads only the markers around a turn — its
  end and how it ended. It does not read message content, and reports the fact
  of a failed turn rather than the reason Cursor recorded for it. A session is
  labelled by the folder it runs in, which Luke reads from Cursor's own record
  of that folder, not from the chat's generated name.

Luke processes bounded fields needed to identify and display a session:
provider and session identifiers, provider-generated titles, the workspace
folder basename, repository and branch, timestamps, status, model, current tool
activity, reported errors, provider-designated turn recaps, and session or
change links where available. It inspects event types, turn boundaries, tool
calls, and stop reasons to derive those fields and the session status.

Luke does not modify provider files, retain raw records or message history,
inject input, or require provider hooks or plugins. Observed fields are held in
memory for the local display. Luke does not control provider sessions.

## Optional cloud-provider reads

Conductor has no local session state for Luke to observe, and neither do
Cursor's cloud agents. Without a key for one of those providers, Luke sends that
provider no request and reports none of its sessions; the Cursor sessions
running on this machine are read from disk and are unaffected by whether a
Cursor key exists.

When a key is supplied, Luke sends it as a bearer credential to that provider
and issues authenticated `GET` requests only:

- For Conductor, Luke reads the authenticated identity, projects, workspaces the
  authenticated user created, sessions, and session statuses. It processes
  identifiers; project, workspace, and session names; repository names derived
  from Git remotes (or the project name when no usable remote is available);
  timestamps; model configuration; archive state; status and reported errors;
  and session deep links.
- For Cursor, Luke reads agents owned by the supplied key and their latest runs.
  It processes identifiers, agent names and links, repository URLs, starting
  refs and run branches, timestamps, archive and run status, provider-designated
  run results, and pull-request links.

Luke does not call provider write routes. Provider-assigned names and results
can reflect task or prompt content; Luke uses their bounded values to distinguish
sessions and describe outcomes. Returned metadata is held in memory for display;
response bodies are not persisted.

Conductor keys may come from Luke's Settings, `CONDUCTOR_API_KEY`, or
`CONDUCTOR_API_TOKEN`; Cursor keys may come from Settings or `CURSOR_API_KEY`.
Keys saved in Settings are encrypted with Electron `safeStorage`, backed by the
macOS login Keychain, and are never returned to the renderer. Environment keys
are not copied into Luke's settings file.

By default, these requests go to the provider's own API. Changing
`CONDUCTOR_API_URL` or `CURSOR_API_URL` sends the corresponding bearer credential
to that configured endpoint, whose policies then govern the request and
response data.

## Local display and microphone

The local panel may show a session's provider-assigned title, status, current
activity or error, provider-designated recap, repository, branch, model, and
session or change links. The links and model label are kept out of the optional
attention-review request described below.

The microphone is optional and is used two ways.

Without `OPENAI_API_KEY` there is nothing to talk to, so Luke never asks for the
microphone and never opens it.

With `OPENAI_API_KEY`, the spoken conversation described below sends microphone
audio to OpenAI. That is the only thing Luke uses the microphone for; there is no
local-only listening mode. Nothing is captured until you open a turn: the
microphone track is created muted, server-side voice detection is disabled, and
each turn begins by discarding whatever the buffer held. Luke never opens the
microphone on its own.

## Optional spoken conversation

Voice is off unless `OPENAI_API_KEY` is set, and no audio leaves your Mac
without it.

When you open a turn, Luke sends that turn's microphone audio to the OpenAI
Realtime API over a direct WebRTC connection from your Mac, and plays back the
spoken reply. OpenAI's policies govern that audio and the reply.

Alongside the audio, Luke sends the same bounded session fields the attention
review uses — provider name, session title, status, and the provider's own
summary — so a spoken question about your sessions can be answered. No
transcript, file content, or command output is ever included.

Luke does not record the conversation, write audio to disk, or keep a
transcript. Audio is not retained by Luke in any form.

The standing API key stays in Luke's main process. The renderer receives only a
short-lived client secret minted for one call, which expires on its own.

## Optional external attention review

Without `OPENAI_API_KEY`, Luke does not send an attention-review request.

With `OPENAI_API_KEY`, Luke sends the configured Responses-compatible endpoint
the provider name, displayed session title, previous and current status, review
trigger, repository, branch, current tool activity, reported error, and the
provider-designated session recap. Titles and recaps can reflect task content;
for a Conductor session, the title can contain the project-name fallback
described above. The request also includes fixed review instructions and
synthetic examples. The API key is sent to that endpoint as the request's bearer
credential.

Luke does not send message history, command output, file contents, full
filesystem paths, model labels, session or change links, provider session
identifiers, or locally observed timestamps in that request.

Requests use `store: false`, which disables Responses application-state
storage. This does not mean zero retention: ordinary provider abuse-monitoring
retention may still apply according to the user's API provider and account
controls.

By default, requests go to OpenAI's API. If `OPENAI_BASE_URL` is changed, the
same attention-review data goes to that configured third-party endpoint and is
handled under that endpoint's policies. The bearer credential is also sent to
that endpoint.
