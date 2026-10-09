# Privacy

Last updated: 8 October 2026

Luke is a macOS app for planning a feature by voice. This policy explains
what we collect, who we send it to, and how to turn it off.

## What we collect

**On your Mac.** Luke reads no coding agent session on your Mac, and nothing
on it reads message history, file contents, or command output from your
Mac's own disk or from any other app; the one transcript it shows is a
coding agent's that you started from Luke, read from our service. The planning
model reads a plan's code in a sandbox on our service, never on your Mac,
as described under "How the planning model reads your repository" below. The
only coding agents the Mac app lists are the ones you start on a plan from
its Start button, which our service runs in a sandbox of its own as described
under "Who we send it to" below; it reads no other agent's session, on your
Mac or anywhere else. No part of Luke's judgment runs on this Mac, so no
transcript, working memory, or inbox of his is held here on disk, and in
memory only the Work tab's turns described under "Your conversation with
Luke" below.

**Your conversation with Luke.** No part of Luke's judgment runs on your
Mac, so no record of what he did at your ask is kept on this machine, and
nothing on it writes what you said or what he spoke to disk. The reads of
those words back are a plan's side panel tabs: while the plan is open, Luke
on your Mac reads what was said on the plan's calls from our service for the
Transcript tab, the spoken words alone and never his judgment's record, and,
for each coding agent you started on the plan, that agent's transcript for
its own tab, its words, reasoning summaries, and tool calls with their
output, read while the tab is showing and the agent runs; both are held in
the window's memory to show them and go when you leave the plan or quit
Luke. The other is a plan's Work tab: during a planning call, our service
sends Luke on your Mac each of the planning model's turns as it works, and
the turns of the worker it hands research to: what each wrote, the summary
of its reasoning that OpenAI returns for each step, and each tool it called
with the call's input and what the call answered, such as a command's output
from the plan's repository in its sandbox or a public page's text, each cut
short. Luke holds them in the panel's memory to show them, never in the
voice window and never on disk, and they go when you leave the plan or quit
Luke. The agent tabs and the Work tab, like the Transcript tab, are left out
of the screen recording described under "Usage data and screen recordings"
below. Your default model and effort for a coding agent are kept with your
account preferences on our service, chosen in Settings › Coding agents or by
the model you last started with.
A voice session on this Mac is a call about one plan, and it opens with
nothing of your coding agent sessions and no line of your conversation, from
here or from our service; what Luke knows when he answers a spoken ask he
reads on our service, from the plan and the record described under "Your
account" below. What our servers keep
of a conversation is the record described under "Your account" below; a
fixture or evidence run keeps no conversation at all.

**Feature plans.** When you start a named plan, our service stores it under
your account: its name and the plan's one document, a Markdown body and a list of
assumptions, written by the planning call's notetaker as you talk. It is
stored as written, bound to your account and readable by our own operators,
the same way the conversation described below is. A save
replaces the document and no earlier version is kept; deleting a plan removes
it at once, with the record of each coding agent started on it and the copy
of the plan that agent was handed, and marks the plan's conversation and each
agent's transcript deleted, removed thirty days later; deleting your account
removes every plan.

**A plan's whiteboard.** Each plan has a whiteboard that Luke's planning model
and you can both draw on. Our service stores it with the plan, under your
account: every shape, arrow, line, freehand stroke, and piece of text on it,
with where each stands, and the planning model's latest drawing. It is stored
as drawn and readable by our own operators, like the plan's document. Luke on
your Mac sends our service the whole board each time it changes. The planning
model reads the board as text at the start of each of its turns. Each drawing
call it makes, with what it drew, is stored in the plan's planning
conversation, under the terms described for that conversation. The board can
hold no image or file. Deleting the plan deletes its whiteboard.

**How the planning model reads your repository.** A plan names the GitHub
repository it is about, one the Luke GitHub App is installed on and you can
reach. Luke's planning model, which runs on our service, reads that
repository's code by running shell commands (such as `ls`, `grep`, or `cat`)
in a Vercel Sandbox: an isolated machine our service opens for the plan's
planning conversation, on Vercel's infrastructure, never on your Mac. The
first command checks the repository out, at its default branch and only its
latest commit, with a token the App mints for that one repository and for
reading alone, good for an hour; our service confirms you still reach the
repository before it does. The token is set at the sandbox's network
firewall for the checkout and withdrawn as soon as it ends: it never enters
the sandbox, a command, a command's output, or the conversation's record.
Later commands reuse the checkout. The sandbox has ordinary Internet access
while a command runs. Each command and up to 20,000 characters each of its
output and error text are stored with the plan's planning conversation,
under the terms described for it; deleting the plan deletes them with it.
The checkout stays in the sandbox between commands and, once the sandbox is
stopped for idleness, in a snapshot of it that Vercel keeps until it expires
thirty days after its last use. Nothing written in the sandbox reaches your
repository.

**Code on screen during a planning call.** During a planning call, Luke shows
code from the plan's GitHub repository in a small pane in the Plans tab. When
the planning model wants to show you code, it names a file and a range of
lines, and our service reads those lines from its own checkout of the
repository, in the same sandbox the planning model reads the repository in.
The file path, the line numbers, and the lines themselves (at most 200 lines,
each cut to 400 characters) are stored with the plan's planning conversation,
and our service sends them to your Mac, which draws them. Nothing is read
from your Mac's disk. The service refuses a path outside the checkout and
never reads a file named `.env` or starting with `.env`. Our service tells the
voice model the file path and line numbers on screen, so Luke can refer to
them. The pane and its code are cleared when the call ends. They are never
part of the plan's document.

**Luke's working memory.** Luke's judgment keeps a working memory of its own
turns — the model's record of what he read, said, and did, folded into a
written summary of his own when it grows long — and it is kept where his
judgment runs, on our service, under the terms described under "Your account"
below. Nothing of it is held on your Mac, in memory or on disk: a launch here
begins with none and a quit lets nothing go, because there was nothing here.


Earlier versions of Luke kept the conversation, his working memory, the
things he remembers about you, and a search index over his workspace files in
a database under Luke's own application data, in a folder of its own per agent
(`agents/main/agent.sqlite`, with recovery archives beside it under
`archives/`), and versions before those kept them in three files beside your
settings. This version composes no judgment on your Mac at all and reads and
writes none of them, so that conversation, that memory, and those remembered
things start over on our service. Each launch removes the database and its
recovery archives if it finds them; the three older files stay where they are
until you remove them.

Luke's runtime runs inside the app, and can run on a server you connect to
instead; either way it holds your settings and the encrypted credentials
(decrypted where it runs, under the same Keychain entry) and your account's
session, while the part that draws listens, speaks, holds the keys, and asks
the runtime for everything else. Nothing
about you crosses that boundary that the panel did not already draw; no
stored key, token, or account secret travels in any answer or event, and the
voice window is handed no credential at all — the runtime opens each voice
session itself and hands the window only the connection answer it needs to
hear and be heard. Quitting Luke cancels
what was running and writes down what did not finish rather than finishing it
on paper. The one thing the app still does on this machine at the runtime's
ask is opening an address you asked to open.

**How the plan is written during a planning call.** While you talk a plan
through with Luke on a planning call, a notetaker on our service writes the
plan document; Luke's own judgment no longer does. Once you have been quiet
for about a second, it makes one call to OpenAI (`gpt-5.6-luna`) on our key,
carrying the plan as it is saved, both sides of what was said since its last
note with a few lines before them, and the words of Luke's own replies, and
saves the fields that call answers into that one plan. It runs only during a
planning call you started and only for that call's plan, each run is counted
in your daily usage as Luke's turns are, and a run that fails writes nothing.
Nothing it reads or answers is kept
beyond the saved plan, said aloud, or shown anywhere but the plan itself, and
OpenAI keeps the request and its reply under its own retention policy.

**Your account.** Signing in with Google or GitHub gives us your name, email
address, and which of the two you used. Signing in with GitHub is your
authorization of the Luke GitHub App: the token GitHub gives us reaches only
the repositories where you have installed the App and that you can already
see, with the App's permissions (reading a repository's details, reading and
writing its contents and pull requests, and reading your email addresses),
and it reaches none until you install the App. We keep that token and the
refresh token that renews it sealed under a server-only secret, read them
only on our service, and never hand them to your Mac, a browser, or anyone
else; they go when you delete your account, and you can revoke the App's
access at any time in GitHub's settings under Applications. An account that
signed in with GitHub before the App may still hold the earlier sign-in's
`repo` permission, which Luke no longer uses; revoke it in the same place.
Installing the App stores nothing about you with us: which repositories it
can see is read from GitHub when you choose one. We also keep the records
that keep you signed in, and a daily count of how much voice and review you
have used.
Luke's own maintainers can see that record — your name, email address, which
sign-in you used, when you joined, when you were last active, and your daily
counts — on an admin page of our site that only an account we have marked as an
administrator can open; nothing you type, say, or run in a session appears on
it. The service also keeps your account's conversation with Luke. When Luke runs a turn for you on our service, that
turn writes rows to our database: your ask as it was given; Luke's reply, the
summaries of his reasoning, and each tool he called with its input and its
result; and the turn's model, token counts, and the ids of OpenAI's
responses. When you speak with Luke through
your account, what you said is kept as your line and what his voice said as
his — an answer he gave without running a turn, what he said before and after
one, a reply he read aloud — each written once it has settled,
so the record holds the words you actually heard beside the turns he
ran and the messages he read from.
These rows are not sealed: they are stored as written, and our own operators
can read them. They stand until you delete your account, which removes them at
once; the conversation of a plan you delete, and the transcript of each
coding agent started on it, are marked deleted and removed thirty days later.

**Usage data.** We count how Luke's features are used on the Mac, and attach
your name and email to that record. The counts are event names and values from
a fixed list. A voice session's start is counted
with the source that opened it, our voice service on your account, and never
with a session id. A count made
before you sign in is not sent. Nothing you type or say and nothing from
a session can appear in one: no titles, branches, file paths, prompts, or
error text.

**Screen recordings.** Luke records what his own panel draws, and never your
screen, your editor, your terminal, or any other app. The recording is the
shape of the panel, not its words: before it leaves your Mac, every piece of
text the panel shows is replaced with blocks of the same length, so a plan's
name and its document, a caption of what you or Luke said, your name and email
address, and anything you type into a field all appear as blocks. A screenshot
you attach to the feedback form is left out, since a picture of your screen
could carry another app's words, and so are the feedback form's message
field, a plan's whiteboard, a plan's transcript, a plan's Work tab, and each
coding agent's tab, as a second line. The whiteboard draws its
words as pixels, which the text masking cannot reach, so leaving it out is
its only line, and recording what a canvas draws is switched off. Luke does
not report what you clicked.

Recording starts when Luke opens, before you sign in, so it covers the
signed-out panel and the sign-in. A recording that begins
before you sign in is attached to your account if you sign in while it is
running. One that never reaches a sign-in belongs to nobody, so deleting your
account does not reach it — we have no way to tell it was yours.

**Crash reports.** In ordinary runs, Luke sends Sentry anonymous reports of
unhandled exceptions in its Electron main, preload, and renderer code, along
with anonymous process-session status and native minidumps when an Electron
main, renderer, or GPU process crashes. Sentry's default reports include the
exception message and code path, breadcrumbs, and Electron, operating-system,
runtime, and device context. Luke does not attach your Luke account or user
identity, and does not enable PII collection, tracing, Sentry Replay,
screenshots, profiling, or manual reports of handled errors. Fixture and
evidence runs send no crash reports.

**What earlier versions left on our service.** Earlier versions of Luke
followed your coding agent sessions, kept a notebook, and pushed briefings to
a phone; this version does none of that, and our service no longer reads,
decrypts, or uses anything those versions stored. What they left stays in our
database, unread, until we remove it: a Conductor key an earlier version
synced, encrypted with AES-256-GCM under a server-only secret; the latest
roster of your Conductor sessions it observed, encrypted the same way; Luke's
workspace files — his operating instructions, the things he remembered about
you in `USER.md`, his curated and dated notes — and a cache of numeric
embeddings of their passages; the device rows an earlier Mac app, iOS app, or
Apple Watch app registered, each with its platform, when it was last seen, an
optional push token, and the presence and quiet instants it reported; and the
conversations Luke kept for the sessions he followed and for the helpers he
delegated to. Every one of them is deleted alongside your account if you
delete that. A key or a calendar grant an earlier version kept encrypted on
this Mac stays in its settings file as that version left it, still
encrypted: this version neither reads nor sends it. A key of your own an
earlier version stored for voice is removed from your Mac the next time Luke
opens, without being read.

**Feedback.** If you use the feedback form, we receive what you typed, the name
and email you signed it with, and any screenshots you attached; they reach us
only when you press Send.

## Who we send it to

- OpenAI, for voice and for Luke's own judgment. A voice session is one
  continuous conversation: while you hold the talk key on your Mac,
  everything the microphone hears streams to OpenAI, and the moment you let
  go nothing does, the microphone closing; Luke can still speak into a
  session whose microphone is closed. There is no way to type to Luke; every
  ask is spoken. A Mac's session is a call about one plan, and opens with
  nothing of your coding agents. What you say and what Luke says in a
  call is written to your account's Conversation by our service, as
  described under "Your account" above, and kept nowhere on your Mac. When you use voice through your
  Luke account, your Mac reaches OpenAI through our own voice
  service, which
  creates the session on our key, relays the control and transcript events
  between your device and OpenAI, reads them on our side to keep the record and
  to hand each spoken ask to Luke's judgment (no device of yours answers a
  spoken ask itself), drops the audio OpenAI
  reflects back so neither your voice nor Luke's transits our service, keeps of the
  exchange only the lines described under "Your account" above, logs only
  status codes and byte counts, and records the
  billed seconds of each session once.
  Every voice session is opened this way, through our service on your
  account: nothing on your Mac holds or is handed a credential for OpenAI,
  and your Mac never reaches OpenAI on a key of
  your own. No session opens on its own: a call opens only when you press
  the talk key or the microphone on a plan.
  Luke's judgment is a separate call to OpenAI's Responses API, made from our
  service when you ask him something on a call: it carries the plan's
  conversation's working memory — the plan's saved document, the conversation
  so far, and what the planning model read for it — on our key. No such call is made from your
  Mac: it composes no instructions, offers no tools, and holds no record the
  reply joins; the record is
  the conversation our service keeps, described under "Your account" above.
  OpenAI stores the request and its reply under its own
  retention policy, and our service performs one model call per request and
  stores and logs none of the request, the reply, or the encrypted reasoning
  that travels in it. Each call is counted in your daily usage.
  Every such call also carries a prompt cache key: a hash of the
  conversation's own internal name, sent so a later call reuses the earlier
  calls' billing prefix instead of paying for it again. It identifies nothing
  — no session id or title can be read out of a hash — and our service passes
  it upstream and keeps it no longer than the request. The same count
  includes a request to count a call's tokens or to fold Luke's working
  memory, and each note the planning notetaker writes.
  A
  development build run from a checkout can write a local trace of this
  traffic when the developer's own shell asks for one; a packaged build has no
  such switch and writes none.
- PostHog, for usage data and screen recordings, from the Mac app. The
  counts go through our own service; the recordings go from Luke to PostHog
  directly.
- Sentry, for the anonymous exception, process-session, and native crash reports
  described above.
- Anthropic and OpenAI, for a coding agent. When you start a coding agent on
  a plan, our service runs it in a Vercel Sandbox of its own, with a copy of
  the plan's GitHub repository checked out in it, and calls the model you
  chose, or your account's default, directly on our own key: Anthropic's for
  a Claude model, OpenAI's for a GPT model. Each call carries the plan's
  text, the agent's conversation so far, and what it read of the repository,
  and the provider stores the request and its reply under its own retention
  policy. The agent's transcript, its words, reasoning summaries, and tool
  calls with their output, is written to your account's Conversation by our
  service, as described under "Your account" above. Nothing of the sandbox
  reaches the screen recording. The sandbox has ordinary Internet access, and
  the agent runs the repository's own checks in it; its `web_search` runs on
  the model provider's own search, so a search goes to the provider the agent
  is calling. The sandbox is stopped when the agent's turn ends or you stop
  it, and its checkout, with the agent's changes, stays in a snapshot of it
  that Vercel keeps on the same terms as the planning checkout's, described
  under "How the planning model reads your repository" above.
- GitHub, through the Luke GitHub App, for a coding agent's work. The agent
  checks the repository out, pushes its branch, and opens a pull request
  with an installation token the App mints for that one repository, set at
  the sandbox's network boundary and never inside it; what GitHub sees is
  the App acting on a repository you gave it.
- GitHub, to check for updates. These requests are unauthenticated and carry
  nothing about you.

We do not sell your information or use it for advertising.

## Our website

tryluke.dev counts page views, presses, and sign-in steps using PostHog, and
records the pages themselves. Anything you type is blurred, and so is the text
of whatever you clicked. Your browser contacts PostHog directly, so PostHog sees
your network address, as it does for the app's recordings.

## Storage

Your settings and your account's sign-in tokens stay on your Mac, the tokens
encrypted under a key held in the macOS Keychain, beside whatever settings,
keys, or calendar grants an earlier version kept there, which stay as they
were but for a voice key, removed as described above. Nothing of your
conversation with Luke, his working memory, or his workspace is kept on your
Mac. When Luke runs a turn for you on our service, the conversation it
writes is stored unsealed in our own database, as described above, beside
what earlier versions left there. A checkout of a plan's repository, and a
coding agent's changes to it, are held in a Vercel Sandbox and in the
snapshot Vercel keeps of it, as described above.
Your account information is held by our own
service, usage counts and recordings by PostHog, and crash reports by Sentry.

## Your choices

- Sign out of your Luke account to turn voice off.
- Delete any workspace file an earlier version of Luke left on your Mac;
  nothing reads it now. What earlier versions left on our service goes with
  your account.
- What you say to Luke on a call goes to that plan's conversation, fixed
  when the call opens and never moved afterwards.
- Luke does not listen through your microphone except while you hold the
  talk key. The press opens the microphone and letting go closes it, so
  macOS's microphone indicator is lit exactly while the key is down; the stop
  key closes it too, and is the one key that also tells Luke to stop talking,
  while letting go of the talk key lets him finish. If Luke's key helper cannot start, the key reports
  presses alone, so one press opens the microphone and the next closes it,
  and the Keyboard shortcuts page says so.
- Delete your account from the Account section in Settings. This erases your
  account, your sign-in records, your usage counts, your plans, the
  conversation our service kept, and everything earlier versions left there
  (described under "What earlier versions left on our service"), and asks PostHog to erase your usage data
  and recordings. It does not reach a recording that was never attached to your
  account, as described above. Luke stops recording for the rest of the
  session, and starts again the next time you open it or sign in. Sentry
  reporting continues after deletion, and prior anonymous crash reports cannot
  be identified as yours and targeted through account deletion.
  Deleting does not affect your Google or GitHub account, and anything stored
  only on your Mac stays there until you remove it.

## Google user data

Luke's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. We use what Google returns when you
sign in with it, your name and email address, only to identify your account.
It is not transferred, sold, or used for advertising.

## Contact

Email founders@stagereview.app with any questions about this policy.
