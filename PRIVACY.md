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

When a key is supplied, Luke sends it as a bearer credential to that provider,
and observation issues only reads: authenticated `GET` requests, plus — for
Conductor — one fixed `SELECT` posted to its documented read-only query
endpoint, under the same read-document boundary the Linear section below
describes.

- For Conductor, Luke reads the authenticated identity, projects, workspaces the
  authenticated user created, sessions, session statuses, and each open
  workspace's lifecycle status — whether it is still being stood up, and the
  failure message it carries when standing it up went wrong. It processes
  identifiers; project, workspace, and session names; repository names derived
  from Git remotes (or the project name when no usable remote is available);
  timestamps; model configuration; archive state; status and reported errors;
  and session deep links. For the sessions it observed, Luke also queries
  Conductor's transcripts view for each chat's agent kind, which speaker wrote
  the transcript's last message, and — only when that speaker is the agent —
  the bounded opening of that final message. Luke reports its words as the
  session's recap only while the chat is idle or closed. The excerpt is
  inspected in memory and discarded, the conversation behind it is never
  requested, and nothing but the bounded recap and agent kind is reported.
- For Cursor, Luke reads agents owned by the supplied key and their latest runs,
  and — on a much slower cadence, within Cursor's documented limits — the list
  of repositories the key may launch agents in. It processes identifiers, agent
  names and links, repository URLs, starting refs and run branches, timestamps,
  archive and run status, provider-designated run results, and pull-request
  links.

Observation never calls a provider write route. Luke calls one only when you
ask for the act it performs — a message typed on a session's row or asked for
out loud, a control a session's provider advertised (such as cancelling a
Conductor turn), a new workspace: a Conductor workspace in one of the
projects Conductor reports, or a Cursor agent in a repository Cursor lists —
or another agent started in the workspace an observed Conductor session runs
in — each through the provider's own documented endpoint under the same key,
and each validated against what the latest observation actually reported. A new
workspace can carry the opening task you gave its agent, in your words; that
text goes to the provider the same way a message to an existing session does,
and nowhere else. Nothing automatic reaches a write route. Provider-assigned names and results
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

## Optional issue-tracker reads and spoken acts

Linear is read the way the cloud providers are: without a key, Luke sends
Linear no request and knows nothing about your board. With a key — from Luke's
Settings or `LINEAR_API_KEY` — Luke sends it in the `Authorization` header of
GraphQL `POST` requests to Linear's API and reads the issues assigned to the
authenticated user: identifiers, titles, current state, issue links, and the
team's workflow states. Completed and cancelled issues are not requested, and
issue descriptions and comment threads are never read. Returned metadata is
held in memory; response bodies are not persisted.

Reading and acting are separate GraphQL documents, and observation only ever
sends the read. Luke calls Linear's two write mutations — moving an issue to
another of its team's states, and adding a comment — only to carry out
something you just asked for in a turn you opened — spoken or typed — and only
against an issue and a state the latest read actually listed. Nothing Luke
decides on its own reaches either mutation.

Changing `LINEAR_API_URL` sends the credential to that configured endpoint,
whose policies then govern the request and response data.

## Local display and microphone

The local panel may show a session's provider-assigned title, status, current
activity or error, recap — provider-designated, or for Conductor the agent's
parting words read from its transcript — repository, branch, model, the name
and identifier of the workspace a chat is grouped under where its provider
nests them, and session or change links. The links, model label, and workspace
identifier are kept out of the optional attention-review request described
below.

The microphone is optional and is used two ways.

Without an OpenAI key there is nothing to talk to, so Luke never asks for the
microphone and never opens it.

With one, the spoken conversation described below sends microphone
audio to OpenAI. That is the only thing Luke uses the microphone for; there is no
local-only listening mode. Nothing is captured until you open a turn: the
microphone track is created muted, server-side voice detection is disabled, and
each turn begins by discarding whatever the buffer held. Luke never opens the
microphone on its own.

## Optional spoken conversation

Voice is off until Luke is given an OpenAI key, and no audio leaves your Mac
without one. The key can be connected in Settings, under Integrations, or read
from `OPENAI_API_KEY` in the environment when nothing is stored; a stored key is
held encrypted through the macOS Keychain, is never sent to the panel, and can be
deleted in the same place it was entered. Deleting it turns voice off at once,
along with the attention review described below.

When you open a turn, Luke sends that turn's microphone audio to the OpenAI
Realtime API over a direct WebRTC connection from your Mac, and plays back the
spoken reply. OpenAI's policies govern that audio and the reply.

Alongside the audio, Luke sends the same bounded session fields the attention
review uses — provider name, session title, status, the name of the workspace
a chat belongs to where its provider groups them, and each session's recap —
so a spoken question about your sessions can be answered. No message history,
file content, or command output is ever included: a recap can reflect what a
session was asked and replied — for Conductor it is the agent's own parting
words — but the conversation behind it never travels.

Luke also sends the list of projects a new workspace could be created in —
each project's provider, repository label, and provider-assigned identifier —
so an ask to create one can be validated against what the provider actually
offers.

Luke also sends an app guide describing itself — its features, each setting's
current value, the talk key, and whether each cloud provider is connected — so
a spoken question about Luke can be answered and a spoken ask can change a
setting. The guide never includes an API key, any part of one, or any value
read from your environment beyond whether one exists.

With a Linear key saved, the conversation also carries the issue roster — each
assigned issue's identifier, title, state, and the states its team's workflow
allows — so a question about your board can be answered and an ask validated
against what Linear actually listed. No issue description or comment thread is
ever included, because Luke never reads one.

With "Announce when a session needs you" on — it is on by default, and does
nothing without an OpenAI key — Luke also opens a call of his own to speak
a session announcement when no conversation is up. That call is narrower in
every direction: it receives audio and sends none (no microphone track exists
on it, so nothing can be captured), it carries no tools, and the only thing
sent up it is the announcement sentence itself — the session's provider name,
title, repository or branch, and the provider's one-line error reason when
there is one. The session roster, workspace projects, app guide, and issue
roster named above travel only on conversations you open yourself. The call
closes itself shortly after the announcement is spoken.

Luke does not record the conversation, write audio to disk, or keep a
transcript. With captions enabled in Settings — they are off by default — the
reply's text is drawn on screen while Luke speaks; it is discarded when the
reply ends and is never written to disk. Audio is not retained by Luke in any
form.

While the Mac's output is muted or its volume is at zero, the same captions are
drawn even with the setting off, so a reply the speakers would swallow can
still be read. To know when, Luke reads exactly two things from the default
output device — its mute switch and its volume level — through a helper that
can write nothing. That reading never leaves your Mac, is not logged, and Luke
never changes the system volume.

The standing API key stays in Luke's main process. The renderer receives only a
short-lived client secret minted for one call, which expires on its own.

## Optional external attention review

Without an OpenAI key, Luke does not send an attention-review request.

With one — the same key the spoken conversation uses, from either place it can
come from — Luke sends the configured Responses-compatible endpoint
the provider name, displayed session title, the name of the workspace a chat
belongs to where its provider groups them, previous and current status, review
trigger, repository, branch, current tool activity, reported error, and the
session recap — provider-designated, or for Conductor the agent's parting
words read from its transcript. Titles, workspace names, and recaps can
reflect task and reply content; for a Conductor chat, the title is the chat's
own name and the workspace name can contain the project-name fallback
described above. The request also includes fixed review instructions and
synthetic examples. The API key is sent to that endpoint as the request's
bearer credential.

Luke does not send message history beyond that recap, command output, file
contents, full filesystem paths, model labels, session or change links,
provider session identifiers, or locally observed timestamps in that request.

Requests use `store: false`, which disables Responses application-state
storage. This does not mean zero retention: ordinary provider abuse-monitoring
retention may still apply according to the user's API provider and account
controls.

By default, requests go to OpenAI's API. If `OPENAI_BASE_URL` is changed, the
same attention-review data goes to that configured third-party endpoint and is
handled under that endpoint's policies. The bearer credential is also sent to
that endpoint.
