# Privacy

Luke v0.1 observes coding-agent sessions on your Mac. This document describes
the current implementation; it is not a promise about third-party services.

## Required Luke account

Live use starts with an identity-only Google or GitHub sign-in. The hosted Luke
auth service stores the account name, email address, chosen sign-in provider,
and the account and session records needed to keep that sign-in working. The
desktop stores its short-lived access token and refresh token together under
Electron `safeStorage`, backed by the macOS login Keychain. Those tokens remain
in Electron's main process; the renderer receives only whether an account is
signed in and its name, email address, and provider.

The auth service receives no coding-agent sessions, transcripts, file content,
command output, issue data, or provider API keys. Signing in with GitHub does
not make that identity a Copilot credential. Browser sign-out does not sign the
desktop out; the desktop keeps its own refresh token until you sign out in
Luke, or the auth service reports that token revoked or invalid.

You can delete the account from the same place you sign out: the Account
section at the foot of Luke's Settings tab, behind a confirmation. Deleting
erases the service's user record and everything referencing it — the sign-in
records above and the usage counters below — in one cascading database delete,
then signs the desktop out. It does not touch the Google or GitHub identity
you signed in with, and anything stored only on your Mac (provider API keys,
settings, calendar grants) stays until you remove it in Luke.

## Hosted voice and review

A signed-in account includes Luke's voice and attention review under a daily
allowance, run through two endpoints on the same service that holds the
sign-in. They exist so voice works without an OpenAI key of your own;
connecting one routes both features directly to OpenAI instead, and nothing in
this section then applies. Both endpoints authenticate with the same
short-lived access token the sign-in already holds and refuse everything else.

The voice endpoint receives a request to start one call: at most the chosen
voice and speaking pace, each a value from the fixed set the app offers, and
nothing typed or spoken. The service builds the session request from
definitions fixed at its build, sends it to OpenAI under Luke's own key, and
returns the short-lived credential OpenAI minted. The call itself is then a
direct WebRTC connection from your Mac to OpenAI — microphone audio and spoken
replies never transit Luke's servers. At launch, Luke also sends this endpoint
one request that carries nothing and authenticates nothing, purely so the
serverless function is loaded before your first press needs it; the endpoint
refuses it by design.

The review endpoint receives the same bounded session fields the attention
review section below lists — never message history, file content, command
output, or provider session identifiers, which do not travel even to Luke's
service. The service adds the same fixed instructions and synthetic examples
the app itself would have sent — both sides are built from one shared
definition — forwards the request to OpenAI under Luke's key with `store:
false`, and returns the decision. The update is inspected in memory and
discarded.

What the service keeps is a counter: how many calls and how many reviews your
account spent each UTC day, checked against the allowance and deleted with the
account. Request content is not written to its logs; a failure is recorded as
a status alone. What OpenAI receives on these paths is the same as on the
keyed paths below, under Luke's key rather than yours, and OpenAI's policies
govern it the same way.

## Update check

Luke asks GitHub's public API for the name of this repository's latest
published release, so the Settings tab's Updates row can say whether a newer
build exists. The request is unauthenticated and carries no account, session,
transcript, or key material — GitHub sees what any HTTPS request shows it,
such as the network address it came from, under GitHub's own policies. Only
the release's version name is read from the answer.

Luke asks at launch and a few times a day while running, and at the press of
the Updates row's Check for Updates button. Fixture and evidence runs never
check. What a check learns changes only what the row says: fetching an update
is your own download in the browser, from the repository's releases page, and
Luke never modifies the running app.

## What Luke reads locally

- For Claude Code, Luke finds recent session files, opens bounded tails
  read-only, and inspects them in memory.
- For Codex, Luke opens the local SQLite state database in read-only mode and
  reads the recent rollout logs named by its thread records.
- For OpenCode, Luke opens the local session database in read-only mode and
  reads session records plus the bookkeeping of a session's newest message and
  tool records — roles, timestamps, tool names and inputs, and recorded
  errors — not the message text, which observation never opens. Installs from
  before OpenCode moved its sessions into that database are read from its
  session and message JSON files with the same boundary.
- For the Devin sessions running on this machine, Luke opens the Devin CLI's
  local session database in read-only mode and reads session records plus the
  bookkeeping of a session's newest turn — the roles along the conversation's
  chain, whether the newest reply opened tool calls, and the stored name of a
  tool call still running. The chain's message records are inspected in memory
  for that bookkeeping alone and their words are never reported, and the
  column holding a tool call's output is never read. Observation reports no
  failure for a Devin session, because its database records none this build
  reads.
- For the Cursor agents running on this machine, Luke finds recent transcripts,
  opens bounded tails read-only, and reads only the markers around a turn — its
  end and how it ended. Observation does not read message content, and reports
  the fact of a failed turn rather than the reason Cursor recorded for it. A
  session is labelled by the folder it runs in, which Luke reads from Cursor's
  own record of that folder, not from the chat's generated name.

Luke processes bounded fields needed to identify and display a session:
provider and session identifiers, provider-generated titles, the workspace
folder basename, repository and branch, timestamps, status, model, current tool
activity, reported errors, provider-designated turn recaps, and session or
change links where available. It inspects event types, turn boundaries, tool
calls, and stop reasons to derive those fields and the session status.

Luke does not retain raw records or message history, inject input, or require
provider hooks or plugins. Observed fields are held in memory for the local
display. Observation itself never controls a provider session; see Optional
cloud-provider reads and Optional issue-tracker reads and spoken acts below
for the narrow, user-requested writes Luke makes elsewhere.

One provider file per provider is the exception to "does not modify", and it
is configuration rather than session data: Luke merges an observation hook
into Claude Code's user-level `settings.json` and Codex's user-level
`hooks.json` at every launch, preserving whatever the user put there and
refusing to rewrite a file it cannot parse. Each hook runs at a session's turn
boundaries and writes one fixed status token — such as `stop` or
`notification` — into a file named by the session's id under Luke's own
application data. It reads the event envelope the provider hands it only to
find that id; no prompt text, message content, or transcript ever reaches the
file. The registered command is a guarded no-op wherever Luke is gone, and
removing the entries by hand costs only the sharper status: observation
continues from the transcripts and state databases alone. Codex additionally
shows a newly merged hook to you at its own startup and runs nothing until you
trust it there; declining costs the same sharper status and nothing else.

"Does not retain raw records or message history" — and, for OpenCode and
Cursor, "observation never opens message content" — have one bounded,
on-demand counterpart: in a conversation you are holding with Luke, you can
ask what a local session did, said, or is stuck on, and Luke reads that
session's own transcript — Claude Code, Codex, OpenCode, and the Devin and
Cursor agents running on this machine today — from the provider's own file or
database on this machine. The
read happens when you ask, is validated against the observed roster, renders a
bounded excerpt into that conversation's reply, and keeps nothing: no history
is stored, watched, or indexed, and nothing is fetched from any provider.
Observation passes stay content-blind exactly as described above; this read is
the one path to a local session's words, and it renders only what the provider
wrote down — Cursor stores no tool outputs in its transcripts, so a Cursor
excerpt carries none. Because the voice conversation runs on OpenAI's Realtime
API, an excerpt read into it leaves the machine the same way your spoken words
do — only in the conversation you opened, never unbidden. The attention
evaluator still never receives transcript content.

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

Linear is read the way the cloud providers are, but connected the way the
calendar is: without a connection, Luke sends Linear no request and knows
nothing about your board. Connecting runs Linear's own OAuth flow for a public
client — Linear's consent page opens in your browser, the authorization code
comes back over a loopback redirect that never leaves the machine, and the
exchange is verified with PKCE. No API key is ever typed, read from your
environment, or held by Luke. The integration exists only in builds carrying a
registered OAuth client; without one it is not offered at all.

The grant is stored encrypted at rest and read only in the main process.
Linear's access tokens last a day, so Luke renews the grant with the refresh
token Linear issued alongside it; Linear consumes a refresh token when it is
spent, so each renewal is written before it is used. Only Linear refusing a
renewal disconnects the integration — a network that could not carry the
request leaves the grant untouched. Disconnecting revokes the grant with
Linear as well as deleting it here.

Under that grant, Luke sends `Bearer` GraphQL `POST` requests to Linear's API
and reads the issues assigned to the authenticated user: identifiers, titles,
current state, issue links, and the team's workflow states. Completed and
cancelled issues are not requested, and issue descriptions and comment threads
are never read. Returned metadata is held in memory; response bodies are not
persisted.

Reading and acting are separate GraphQL documents, and observation only ever
sends the read. Luke calls Linear's two write mutations — moving an issue to
another of its team's states, and adding a comment — only to carry out
something you just asked for in a turn you opened — spoken or typed — and only
against an issue and a state the latest read actually listed. Nothing Luke
decides on its own reaches either mutation.

The consent page asks for Linear's `read` and `write` scopes, which are the
narrowest pair carrying both acts: Linear publishes no scope for moving an
issue between states. What bounds the acts is not the scope but the validation
above it — only an issue and a state the latest read listed, and only in a turn
you opened.

Changing `LINEAR_API_URL` sends the credential to that configured endpoint,
whose policies then govern the request and response data.

## Optional calendar reads

Google Calendar is read the same way: without an account signed in, Luke sends
Google no request and knows nothing about your calendars. The integration
exists only in builds carrying a registered OAuth client; without one it is
not offered at all.

Connecting an account runs Google's own consent flow for an installed app: the
browser opens Google's consent page, the grant returns over a loopback
redirect on this machine (`127.0.0.1`), and the code is exchanged — with PKCE
— at Google's token endpoint. Two scopes are requested and no more:
`calendar.freebusy` (your availability) and `calendar.calendarlist.readonly`
(the list of your calendars). Several accounts can be connected side by side;
each refresh token is encrypted with Electron `safeStorage`, never returned to
the renderer, and deleted when the account is disconnected. You can also
revoke Luke's access at any time in your Google account's security settings.

With an account connected, Luke reads two things every few minutes. The
calendar list — each calendar's id, name, and colour — is what names the
account and lets you choose, per account, which calendars count; the names and
colours are shown in Settings on this machine and are never persisted or sent
anywhere. For the
chosen calendars, Luke `POST`s the Calendar API's free/busy query, and Google
answers with busy intervals only — a title or an attendee cannot travel in
that response at all. The query names only calendar ids the same pass's list
reported. Events themselves are never read: Luke holds no event scope.

The intervals gate exactly one behavior, on this machine: while a meeting is
on and the "Quiet during meetings" switch is enabled, Luke's spoken
announcements wait and are read out after the meeting ends. Nothing about the
calendar leaves the machine — meeting times are never sent to the voice
service, the attention evaluator, or anywhere else.

## Local display and microphone

The local panel may show a session's provider-assigned title, status, current
activity or error, recap — provider-designated, or for Conductor the agent's
parting words read from its transcript — repository, branch, model, the name
and identifier of the workspace a chat is grouped under where its provider
nests them, and session or change links. The links, model label, and workspace
identifier are kept out of the optional attention-review request described
below.

The microphone is optional.

While voice is unavailable — no signed-in account and no OpenAI key — there is
nothing to talk to, so Luke never asks for the microphone and never opens it.

While voice is available, the spoken conversation described below sends microphone
audio to OpenAI. That is the only thing Luke uses the microphone for; there is no
local-only listening mode. Nothing is captured until you open a turn: the
microphone track is created muted, server-side voice detection is disabled, and
each turn begins by discarding whatever the buffer held. Luke never opens the
microphone on its own.

## Optional spoken conversation

Voice runs one of two ways, and which one is yours to choose. Running on your
Luke account, calls open through the hosted service described above, under its
daily allowance. Running on an OpenAI key of your own, everything below runs on
that key directly against OpenAI, and Luke's service sees none of it. The
choice is the two-way toggle under What Luke runs on, at the top of the
Settings tab's front page: with no key stored the account is the only source
there is, connecting a key chooses it, and choosing the account again parks a
stored key without deleting it — so trying your own key does not cost you the
free allowance, and returning to the allowance does not cost you the key.

The choice can only ever move spending away from your key, never onto it. A
key that is stored but not chosen is not read at all, and if the account it was
parked in favour of stops being able to answer — you sign out — the stored key
is what is left rather than voice going off. Nothing else falls back: a chosen
account with no key behind it simply has no key to fall back to.

The key is connected by hand in the same section — alone among
Luke's credentials it is never read from the environment, because an
`OPENAI_API_KEY` exported for some other tool must not silently start being
spent on voice or move the review path. A stored key is held encrypted through
the macOS Keychain, is never sent to the panel, and can be deleted in the same
place it was entered. Deleting it returns voice to the hosted path while you
are signed in, and turns voice off entirely otherwise — along with the
attention review described below, which follows the same two paths.

When you open a turn, Luke sends that turn's microphone audio to the OpenAI
Realtime API over a direct WebRTC connection from your Mac, and plays back the
spoken reply. OpenAI's policies govern that audio and the reply.

Alongside the audio, Luke sends the same bounded session fields the attention
review uses — provider name, session title, status, the name of the workspace
a chat belongs to where its provider groups them, repository or branch, the
tool a session is currently running, the provider's reported error line, and
each session's recap — so a spoken question about your sessions can be
answered with what a session is doing or stuck on, not only that it works or
waits. Each roster line also states what the session can be asked to do —
whether it takes messages, can be opened, is a local session whose transcript
can be read on ask, has a pull request, and which controls its provider
advertised — as facts, never as addresses. A standing ask you have made about
a session (described below under the attention review) rides its roster line
in your own words, so Luke can say what he is already listening for. No
message history, file content, or command output is ever included: a recap
can reflect what a session was asked and replied — for Conductor it is the
agent's own parting words — but the conversation behind it never travels.

Luke also sends the list of projects a new workspace could be created in —
each project's provider, repository label, and provider-assigned identifier —
so an ask to create one can be validated against what the provider actually
offers.

Luke also sends an app guide describing itself — its features, each setting's
current value, the talk key, and whether each cloud provider is connected — so
a spoken question about Luke can be answered and a spoken ask can change a
setting. The guide never includes an API key, any part of one, or any value
read from your environment beyond whether one exists.

With Linear connected, the conversation also carries the issue roster — each
assigned issue's identifier, title, state, and the states its team's workflow
allows — so a question about your board can be answered and an ask validated
against what Linear actually listed. No issue description or comment thread is
ever included, because Luke never reads one.

While voice is available — announcements do nothing while it is not —
Luke also opens a call of his own to speak a session announcement when no
conversation is up. That call is narrower in
every direction: it receives audio and sends none (no microphone track exists
on it, so nothing can be captured), it carries no tools, and the only thing
sent up it is the one update's bounded fields — the session's provider name,
title, the name of the workspace it is one chat of, repository or branch,
what changed, the provider's one-line error reason when there is one, whether
the session takes a reply, and — for a session that started waiting or
finished — a bounded excerpt of the same session recap the attention review
and open conversations above already carry. The voice words those fields into
the announcement you hear, so it can say what the session is waiting on
rather than only that it waits; whether and when to announce is decided on
your Mac by the status change alone. As above, a recap can reflect what a
session was asked and replied, but the conversation behind it never travels.
The session roster, workspace projects, app guide, and issue roster named
above travel only on conversations you open yourself. The call closes itself
shortly after the announcement is spoken.

While an announcement is being spoken, a pressable notice on Luke's own
surface under the notch names the session it is about. The notice is drawn
entirely on your Mac from what Luke already observed and nothing about it
leaves it: pressing it only hands the session's provider-reported address to
macOS — the same thing pressing the session's row does — or opens Luke's own
panel when the session reported none.

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

The standing API key — or, on the hosted path, the account's access token —
stays in Luke's main process. The renderer receives only a short-lived client
secret minted for one call, which expires on its own; either way that secret
is the only credential a call ever holds, and the call it opens goes straight
to OpenAI.

## Optional external attention review

The attention review follows voice's two paths. While voice is unavailable,
Luke sends no attention-review request at all. On the hosted path the same
bounded fields listed below go to Luke's review endpoint instead, as the
Hosted voice and review section describes, and the service forwards them to
OpenAI under Luke's key with the same fixed instructions.

With a key of your own — the same stored key the spoken conversation uses —
Luke sends the configured Responses-compatible endpoint
the provider name, displayed session title, the name of the workspace a chat
belongs to where its provider groups them, previous and current status, review
trigger, repository, branch, current tool activity, reported error, and the
session recap — provider-designated, or for Conductor the agent's parting
words read from its transcript. When you have asked Luke to keep a standing
ask about a session — "tell me when this finishes" — that ask also travels
with that session's updates, in your own words, so the review can answer it;
it is withdrawn the same way it was made and dropped with the session it was
about. Titles, workspace names, and recaps can
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

By default, keyed requests go to OpenAI's API. If `OPENAI_BASE_URL` is
changed, the same attention-review data goes to that configured third-party
endpoint and is handled under that endpoint's policies. The bearer credential
is also sent to that endpoint. The variable redirects only the keyed path: the
hosted path's endpoints are fixed at build.
