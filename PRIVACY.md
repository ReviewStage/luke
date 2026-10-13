# Privacy

Last updated: 13 October 2026

Luke is a macOS app for planning a feature by voice. This policy explains
what we collect, who we send it to, and how to turn it off.

## What we collect

**On your Mac.** Nothing in Luke reads a coding agent session, message
history, file contents, or command output from your Mac's disk or from any
other app, except a file you hand it to attach to a coding agent's message
(see "Files you attach to a coding agent"). The only coding agents it lists
are the ones started on a plan from Luke — its Start button, New coding
agent, or Luke on a planning call — which our service runs in sandboxes of
their own (see "Who we send it to"), and the one transcript it shows is such
an agent's, read from our service. The planning model reads a plan's code in
a sandbox on our service, never on your Mac. No part of Luke's judgment runs
on this Mac, so no transcript, working memory, or inbox of his is held here
on disk, and in memory only the tabs described next.

**Your conversation with Luke.** Nothing on your Mac writes what you said or
what Luke spoke to disk, and no record of what he did is kept there. While a
plan is open, Luke on your Mac reads from our service, for the plan's side
panel: the spoken words of the plan's calls, for the Transcript tab, never his
judgment's record; each coding agent's transcript (its words, reasoning
summaries, and tool calls with their output), for its own tab, while the tab
shows and the agent runs; and, for the Work tab, the turns of the planning
model and of the worker it hands research to — what each wrote, the summary
of its reasoning that OpenAI returns for each step, and each tool call's input
and answer, such as a command's output from the plan's repository or a public
page's text, each cut short. Our service keeps those turns with the plan's
planning conversation, sends them live during a call, and Luke reads them
back when you open the plan, the newest twenty first and older ones as you
scroll. All of this is held in the panel's memory, never in the voice window
or on disk, goes when you leave the plan or quit Luke, and is left out of the
screen recording (see "Screen recordings"). Your default model, effort, and
context size for a coding agent are kept with your account preferences on our
service, set in Settings › Coding agents or by the model you last started
with.

A voice session on this Mac is a call about one plan. It opens with nothing
of your coding agents and no line of your conversation; what Luke knows when
he answers a spoken ask he reads on our service, from the plan and the record
described under "Your account". During the call, Luke's planning model can
list the plan's coding agents, read the last few turns of one's transcript,
send one a message it writes for you (kept in that agent's transcript as
yours), and start a new one; what it read and sent is kept with the plan's
planning conversation. A fixture or evidence run keeps no conversation at all.

**Feature plans.** When you start a named plan, our service stores under your
account its name and its one Markdown document, which begins as a copy of
your plan template and is written by the planning call's notetaker, by coding
agents started on it, and by you, when you edit a section or restore an
earlier version. Your edits are sent as you pause typing and when you finish;
unsaved words stay in Luke's memory on your Mac, never on disk. Our service
keeps the plan's history without limit: the document after each revision
(saves one writer makes close together count as one), who wrote it (you,
editing or restoring which version; the notetaker, on which call; or which
coding agent) and when, and who last changed each section and when, so Luke
can say so beside it. A coding agent's last fifty saves are also kept as its
notes, so Luke can tell you what it changed. All of it is stored as written,
bound to your account and readable by our own operators, like the
conversation described below. Luke on your Mac remembers, for each plan, only
the time of its newest save when you last had it open, to show which sections
changed since.

Deleting a plan removes it at once with its history, its inbox, and the
record of each coding agent started on it with the plan copy or task that
agent was handed, and marks the plan's conversation and each agent's
transcript deleted, removed thirty days later. Before it deletes anything, it
stops every coding agent of the plan still at work, as Stop does; if one
cannot be stopped just then, or is still starting, the plan is not deleted
and you can try again in a moment. It also deletes the record of each of the
plan's calls, with every line said on it (see "Your account"): at once for a
call that has ended, and within a minute or so of its end for a call still
open. Deleting your account removes every plan. Pinning or archiving a plan
stores only when you did it and deletes nothing.

**Your plan template.** The template new plans start from is kept with your
account preferences on our service, as you write it in Settings › Plan
template (up to 20,000 characters; a built-in one until you do). A new plan
begins as a copy of it; no model reads the template itself. Deleting your
account removes it.

**Pinned repositories.** When you pin a repository in the sidebar, our
service stores its name and when you pinned it under your account, so the pin
follows you to every Mac you sign in on. Unpinning deletes that record, and
deleting your account removes them all.

**A plan's inbox.** When a coding agent on a plan needs a decision from you,
or something only you can do such as changing a GitHub setting, it posts an
item to the plan's inbox on our service: a title, context in Markdown, links,
references to lines of its repository (a path, the lines, and the commit,
never the lines themselves), and how it asks to be answered, with any options
or form fields. An item may carry a picture the agent took in its sandbox,
such as a screenshot of a page it rendered, with the agent's description of
up to 300 characters: our service reads the file from the sandbox, keeps the
image, up to 1.5 MB, in our database beside the item, and serves it only to
Luke signed in as you. Items and their pictures are stored under your account
and readable by our own operators, like the agent's transcript. The agent can
change or withdraw an item, and our service keeps each as it last stood; a
picture goes when the item stops naming it. Your answer, and any note, is
stored with the item and, where the agent asked to hear back, handed to it as
one of your messages, kept in its transcript. While you are signed in, Luke
on your Mac reads the items waiting on you to count them in its sidebar and
on its Dock icon. While its window is behind, a Mac notification names a new
item by its plan, agent, and title, and a coding agent's ended turn by its
plan, the agent's title, and whether it finished or failed, or its branch's
pull request number; macOS shows and keeps these as it does any app's.
Deleting the plan, or your account, deletes its items.

**Files you attach to a coding agent.** You can attach files to a coding
agent's message, or to the task you start one with, by picking them with +,
dropping, or pasting: images, PDFs up to 3 MB, and text files up to 100 KB, up
to ten files and 3 MB a message. A PNG, JPEG, or WebP up to 1.5 MB is sent as
it is; any other image, or a larger one, is first made into a smaller WebP on
your Mac. Luke reads only the files you hand it and sends our service each
one's name and contents, including whatever the file carries inside it, such
as where and on what a photo was taken, but never where it was on your Mac.
Our service sends them to the agent's model with your message and with every
later call, copies images and PDFs into the agent's sandbox, and keeps them in
the agent's transcript, stored as sent and readable by our own operators,
except that the task an agent is started on keeps an image or PDF by name
alone. They go when the transcript does; the sandbox's snapshot and the
agent's session history keep them on the terms under "Who we send it to".

**Your own API keys.** If you add an Anthropic or OpenAI API key in
Settings, your Mac sends it once, over HTTPS, to our service, which keeps it
only if the provider accepts it when asked for its list of models, a request
that costs nothing. It is stored under your account encrypted with
AES-256-GCM, under a key drawn for it alone that is itself encrypted under a
server-only secret held outside the database, so a copy of our database alone
cannot read it; our operators who hold both could. Beside it we keep the
provider, a hint (the `sk-` prefix and the word after it where it has them,
and the last four characters, such as `sk-ant-…abcd`), when you last saved
it, and whether, and when, the provider last accepted it, refused it, or said
it was out of credit, or our service could no longer read it, which each
coding agent call on it updates. Only coding agents and their workers use it;
Luke's planning model, voice, notetaker, dictation, and titles always run on
our keys. After you save it, neither your Mac nor any answer from our service
holds the key again, and we never log it or send it to our analytics, crash
reports, or screen recordings. Removing it in Settings, or deleting your
account, deletes it.

**A plan's whiteboard.** You and Luke's planning model can both draw on a
plan's whiteboard. Our service stores it with the plan, as drawn and readable
by our own operators: every shape, arrow, line, stroke, and piece of text and
where it stands, and the planning model's latest drawing. Luke on your Mac
sends the whole board each time it changes and, with a save holding a new
drawing of the model's or one the model is waiting to look at, a picture of
the board as your Mac draws it, at most 1,200 pixels a side, kept in place of
the last one. The model reads the board as text at the start of each turn and
may look at that picture to check what it drew, which sends the picture to
the model; our service does not copy it into the planning conversation,
though the model's session history may keep it (see "Who we send it to").
Each drawing call, with what it drew, is stored in the planning conversation.
You cannot put an image or a file on the board. Deleting the plan deletes its
whiteboard.

**How the planning model reads your repository.** A plan names a GitHub
repository the Luke GitHub App is installed on and you can reach. The
planning model reads its code by running shell commands (such as `ls`,
`grep`, or `cat`) in a Vercel Sandbox: an isolated machine our service opens
for the plan's planning conversation, on Vercel's infrastructure, never on
your Mac. The first command checks out the default branch's latest commit,
after our service confirms you still reach the repository, with a read-only
token the App mints for that one repository, good for an hour. The token is
set at the sandbox's network firewall for the checkout and withdrawn when it
ends: it never enters the sandbox, a command, its output, or the
conversation's record. The sandbox has ordinary Internet access while a
command runs. Each command, the few words the model gives to describe it, and
up to 20,000 characters each of its output and error text are stored with the
planning conversation, under its terms. The checkout stays in the sandbox
between commands and, once the sandbox is stopped for idleness, in a snapshot
Vercel keeps until thirty days after its last use. When the plan's
conversation is removed, thirty days after you delete the plan, our service
deletes the sandbox of each of its sessions and of its coding agents', with
the snapshots no other sandbox uses, shortly after; deleting your account
does the same for every session of yours, shortly after the deletion. A
session a plan's conversation was moved off earlier in its life is not
tracked, and its snapshot stays until Vercel lets it expire. Nothing written
in the sandbox reaches your repository.

**Code on screen during a planning call.** When the planning model wants to
show you code, it names a file and lines, and our service reads them from
the same sandbox checkout. The path, the line numbers, the lines (at most
200, each cut to 400 characters), and the model's note on why it showed them
(at most 280 characters) are stored with the planning conversation and sent
to your Mac, which draws them in the plan's Code tab; nothing is read from
your Mac's disk. The service refuses a path outside the checkout and never
reads a file named `.env` or starting with `.env`. The voice model is told
the path and line numbers on screen, so Luke can refer to them. When you open
the plan, Luke on your Mac reads back all the code shown on it, by the same
rules, and holds it in the panel's memory, never on disk, until you leave the
plan or quit Luke. It is never part of the plan's document.

**A whole file opened from a snippet.** A snippet in the Code tab can open
its whole file in a File tab. Our service reads the file from GitHub at the
head of the default branch: it confirms you still reach the repository and
mints a token for that one repository that reads its contents, used for that
read and never sent to your Mac, logged, or kept. The rules for code on
screen apply, and a link, a folder, a file over a megabyte, or one that is
not text is refused. The file is read 500 lines at a time as you scroll, is
not stored by our service, and is held by Luke only while its tab is open,
never on disk, except that copying or downloading it reads it whole (up to
that megabyte, lines uncut) and a download is written where you save it. The
File tab's tree lists the repository's folders and file names the same way,
through our service, which does not store them, and Luke holds them in memory
only; a `.env` file's name may be listed, though the file is never read.
Because it is read as GitHub has it now, a file may differ from the lines
Luke showed. An inbox item's line reference is read the same way, at the
commit the agent named, for the lines on the item and the File tab it opens;
nothing of the file is stored.

**Pages an agent makes.** Luke's planning model and coding agents can make a
page for a plan: an interactive HTML document, such as a chart or a mockup,
that opens in the plan's side panel. Our service stores each page with the
plan, as written and readable by our own operators: its title and HTML, at
most 256 KB a version, and every version it has had, each kept as written and
never changed. Deleting the plan deletes its pages. A page made by the
planning model is part of the planning conversation, so it is sent back to
the planning model as the conversation goes on (see "Who we send it to").
Luke on your Mac reads a page's HTML from our service only to draw it, holds
it in memory only, and never passes it to the rest of the panel. A page runs
sealed off from Luke: it cannot read the panel, your account, or another
page, and cannot store anything, open a window, or send anything anywhere.
The one place it may load from is cdnjs.cloudflare.com, for code libraries
such as charts and diagrams, which Cloudflare's CDN then sees requested from
your Mac's address. A link inside a page does not open. A page is never
shared or published: only you can open it, from Luke.

**Luke's working memory.** Luke's judgment keeps a working memory of its own
turns — the model's record of what he read, said, and did, folded into a
written summary when it grows long — on our service, under the terms
described under "Your account". None of it is held on your Mac, in memory or
on disk.

Earlier versions kept the conversation, his working memory, the things he
remembered about you, and a search index over his workspace files in a
database under Luke's application data (`agents/main/agent.sqlite`, with
recovery archives under `archives/`), and versions before those in three
files beside your settings. This version reads and writes none of them, so
all of that starts over on our service. Each launch removes the database and
its archives if it finds them; the three older files stay until you remove
them.

Luke's runtime runs inside the app, or on a server you connect to; either way
it holds your settings, the encrypted credentials (decrypted where it runs,
under the same Keychain entry), and your account's session, while the part
that draws listens, speaks, holds the keys, and asks the runtime for
everything else. Nothing about you crosses that boundary that the panel did
not already draw; no stored key, token, or account secret travels in any
answer or event, and the voice window is handed no credential — the runtime
opens each voice session and hands the window only the connection answer it
needs to hear and be heard. Quitting Luke cancels what was running and writes
down what did not finish rather than finishing it. The one thing the app
still does on this machine at the runtime's ask is open an address you asked
to open.

**How the plan is written during a planning call.** A notetaker on our
service, not Luke's judgment, writes the plan during a planning call. Once
you have been quiet for about a second, it makes one call to OpenAI
(`gpt-5.6-luna`) on our key, carrying the saved plan, both sides of what was
said since its last note with a few lines before them, and Luke's own
replies, and applies the notes that call answers: a point added under a
heading (adding the heading where the plan lacks it), a phrase replaced, or
the lines a phrase names removed. It is told which sections you last wrote,
so it adds to your words rather than rewording them, and so is Luke's
planning model. It runs only during a call you started and only for its
plan, each run counts in your daily usage, and a failed run writes nothing.
Nothing it reads or answers is kept beyond the plan and its history, said
aloud, or shown elsewhere; OpenAI keeps the request and its reply under its
own retention policy.

**Your account.** Signing in with Google or GitHub gives us your name, email
address, the address of your profile picture, and which of the two you used.
Signing in with GitHub authorizes the Luke GitHub App: its token reaches only
repositories where you installed the App and can already see, with the App's
permissions (reading a repository's details; reading and writing its contents
and pull requests; reading its checks, commit statuses, and Actions runs with
their logs where the installation has accepted them; and reading your email
addresses), and none until you install it. We keep that token and its refresh
token sealed under a server-only secret, read them only on our service, and
never hand them to your Mac, a browser, or anyone else; they go when you
delete your account, and you can revoke the App in GitHub's settings under
Applications, where an account that signed in before the App may also hold
an unused `repo` permission to revoke. Signing in with Google leaves us
Google's sign-in tokens, kept on our service and used for nothing after the
sign-in. Installing the App stores nothing about you: which repositories it
can see is read from GitHub when you choose one. We also keep the records
that keep you signed in, each with the network address and the browser or app
it was signed in from, and a daily count of your use of our service — one for
each voice session you opened, each model call Luke's planning model or its
research worker makes, each web search, each notetaker run, and each clip
you dictated — and how many seconds you dictated.

Luke's own maintainers can see your name, email address, profile picture,
sign-in method, whether you are an administrator, when you joined and were
last active, and your daily counts, on an admin page of our site that only an
account we have marked as an administrator can open; nothing you type, say,
or run appears on it.

The service also keeps your conversation with Luke. Each turn he runs for you
writes to our database your ask as given; his reply, the summaries of his
reasoning, and each tool call with its input and result; and the turn's model
and effort, token counts, and when it was queued, started, and ended, and how
(rows from earlier versions may also hold the ids of OpenAI's responses). On
a call, what you said is kept as your line and what his voice said as his —
an answer he gave without a turn, what he said around one, a reply he read
aloud — each written once it has settled, so the record holds the words you
heard beside the turns he ran. Each call also keeps a record of its own: its
plan, OpenAI's id for the session, when it started and ended and why, its
voice model, its billed seconds (or our own count where OpenAI gave none),
and each line said on it, by whom and when; the plan's Transcript tab shows
it. These rows are not sealed: they are stored as written, and our own
operators can read them. They stand until you delete your account, which
removes them at once. A deleted plan's conversation and its agents'
transcripts are marked deleted and removed thirty days later; its call
records, with the lines said on them, are deleted with the plan, or within a
minute or so of the call ending for a call still open.

**Linear, if you connect it.** Connecting Linear in Settings › Integrations
signs you in to Linear in your browser through Vercel Connect, which stores
Linear's token for your account, encrypted, and renews it. Our service never
writes the token down: it gets it from Vercel Connect when an agent uses
Linear, holds it in memory while it is used, and sends it only to Linear's MCP
server, never to your Mac, a model, or a sandbox. We keep only your connection's
state (waiting for sign-in, connected, or expired) and when it last changed.
While you are connected, Luke's planning model and its research worker, and
every coding agent and its workers, can read and change whatever your Linear
account can, through Linear's own MCP server, without asking you first. What
Linear answers goes to the model that made the call, and each call, with its
input and everything Linear answered, is written to the plan's conversation
or the agent's transcript like any other tool call. Disconnecting stops Luke
using it from each agent's next step, removes the connection's record, and
asks Vercel Connect to revoke the grant; what agents already changed in
Linear, and the record of it, stays. Deleting your account removes the record
and asks Vercel Connect to revoke the grant in the same way; if Vercel Connect
cannot be reached then, your account is deleted all the same and the grant
stays until you revoke Luke in Linear's own settings.

**Notion, if you connect it.** Connecting Notion in Settings › Integrations
signs you in to Notion in your browser through Vercel Connect, which stores
Notion's token for your account, encrypted, and renews it. Our service never
writes the token down: it gets it from Vercel Connect when an agent uses
Notion, holds it in memory while it is used, and sends it only to Notion's MCP
server, never to your Mac, a model, or a sandbox. We keep only your
connection's state (waiting for sign-in, connected, or expired) and when it
last changed. While you are connected, Luke's planning model and its research
worker, and every coding agent and its workers, can read, create, and change
whatever your Notion account can, through Notion's own MCP server, without
asking you first; they are told to change something only when asked to. What
Notion answers goes to the model that made the call, and each call, with its
input and everything Notion answered, is written to the plan's conversation or
the agent's transcript like any other tool call. Disconnecting and deleting
your account work as they do for Linear: Luke stops using it from each agent's
next step, removes the connection's record, and asks Vercel Connect to revoke
the grant; what agents already changed in Notion, and the record of it, stays,
and a grant Vercel Connect could not revoke stays until you remove Luke in
Notion's own settings.

**Sentry, if you connect it.** Connecting Sentry in Settings › Integrations
signs you in to Sentry in your browser through Vercel Connect, which stores
Sentry's token for your account, encrypted, and renews it. Sentry's sign-in
lists what Luke may do, reading issues and events among it, and you can untick
its write access there to keep Luke to reading. Our service never writes the
token down: it gets it from Vercel Connect when an agent uses Sentry, holds it
in memory while it is used, and sends it only to Sentry's MCP server, never to
your Mac, a model, or a sandbox. We keep only your connection's state (waiting
for sign-in, connected, or expired) and when it last changed. While you are
connected, Luke's planning model and its research worker, and every coding
agent and its workers, can do whatever your Sentry grant allows, through
Sentry's own MCP server, without asking you first; they are told to change
something only when asked to. What Sentry answers, which can include the error
messages, stack traces, and event data your applications sent it, goes to the
model that made the call, and each call, with its input and everything Sentry
answered, is written to the plan's conversation or the agent's transcript like
any other tool call. Disconnecting and deleting your account work as they do
for Linear: Luke stops using it from each agent's next step, removes the
connection's record, and asks Vercel Connect to revoke the grant; what agents
already changed in Sentry, and the record of it, stays, and a grant Vercel
Connect could not revoke stays until you revoke Luke in Sentry's own settings.

**Slack, if you connect it.** Connecting Slack in Settings › Integrations
signs you in to Slack in your browser through Vercel Connect, which stores
Slack's token for your account, encrypted, and renews it. Luke uses Slack
read-only: the agents are offered Slack's search and read tools alone, so they
can search messages, files, channels, and people, and read channels, threads,
canvases, and profiles your Slack account can see, and cannot post, schedule,
react, or write anything. Our service never writes the token down: it gets it
from Vercel Connect when an agent uses Slack, holds it in memory while it is
used, and sends it only to Slack's MCP server, never to your Mac, a model, or
a sandbox. We keep only your connection's state (waiting for sign-in,
connected, or expired) and when it last changed. What Slack answers, which can
include other people's messages in conversations you can see, goes to the
model that made the call, and each call, with its input and everything Slack
answered, is written to the plan's conversation or the agent's transcript like
any other tool call. Disconnecting and deleting your account work as they do
for Linear: Luke stops using it from each agent's next step, removes the
connection's record, and asks Vercel Connect to revoke the grant; the record
of what agents read stays with the plan, and a grant Vercel Connect could not
revoke stays until you remove Luke in Slack's own settings.

**Usage data.** We count how Luke's features are used on the Mac, and attach
your name and email to that record. The counts are event names and values
from a fixed list. A voice session's start is counted with the source that
opened it, our voice service on your account, and never with a session id. A
count made before you sign in is not sent. Nothing you type or say and
nothing from a session can appear in one: no titles, branches, file paths,
prompts, or error text.

**Screen recordings.** Luke records what his own panel draws, never your
screen, your editor, your terminal, or any other app, and records its shape,
not its words: before it leaves your Mac, every piece of text, and every
label, description, picture address, and link address a page carries for
itself, is replaced with blocks of the same length, so a plan's document, a
caption of what you or Luke said, your name and email address, and anything
you type all appear as blocks. As a second line, some parts are left out whole: the
feedback form, since a screenshot you attach could carry another app's words;
a plan's name, its document while you edit it, its whiteboard, transcript,
Work, Code, and File tabs with their tree, its pages, and its version history
with the earlier version you are viewing; the Inbox and its pictures; each coding
agent's tab, its message box, and the files you attach there; code drawn in a
transcript; the API keys and Plan template pages of Settings; and the cards
that open over a row on hover. The whiteboard draws its words as pixels,
which the masking cannot reach, so leaving it out is its only line, and
recording what a canvas draws is switched off. Luke does not report what you
clicked.

Recording starts just after the panel first draws when Luke opens, before
you sign in, so it covers the signed-out panel and the sign-in. A recording
that begins before you sign in is attached to your account if you sign in
while it runs; one that never reaches a sign-in belongs to nobody, so
deleting your account does not reach it — we have no way to tell it was
yours.

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
decrypts, or uses anything they stored. What they left stays in our
database, unread, until we remove it: a Conductor key an earlier version
synced, encrypted with AES-256-GCM under a server-only secret; the latest
roster of your Conductor sessions it observed, encrypted the same way; Luke's
workspace files — his operating instructions, the things he remembered about
you in `USER.md`, his curated and dated notes — and a cache of numeric
embeddings of their passages; the device rows an earlier Mac app, iOS app, or
Apple Watch app registered, each with its platform, when it was last seen, an
optional push token, and the presence and quiet instants it reported; and the
conversations Luke kept for the sessions he followed and for the helpers he
delegated to. All of it is deleted with your account. A key or a calendar
grant an earlier version kept encrypted on this Mac stays in its settings
file as that version left it, still encrypted: this version neither reads nor
sends it. A key of your own an earlier version stored for voice is removed
from your Mac the next time Luke opens, without being read.

**Feedback.** If you use the feedback form, we receive what you typed, any
screenshots you attached, and — unless you untick "Include my name and email"
— the name and email of the account you are signed in with; they reach us
only when you press Send.

## Who we send it to

- OpenAI, for voice and for Luke's judgment. A voice session is one
  continuous conversation. While your microphone is on — while you hold the
  talk key, or from a press of a plan's microphone button, the call card's,
  or the microphone shortcut, or from starting a new plan, until you press
  one of those again or press and let go of the talk key — everything it
  hears streams to OpenAI. When it goes off, Luke tells OpenAI at once to stop
  listening and closes the microphone when OpenAI confirms, within five
  seconds; Luke can still speak while it is closed. Every ask is spoken; there
  is no way to type to Luke. A call opens only when you press the talk key or
  a plan's microphone, or start a new plan, which opens a call about it with
  the microphone on where macOS already lets Luke use the microphone and no
  other call is open. Every session goes through our own voice service on
  your account: nothing on your Mac holds or is handed an OpenAI credential,
  and it never reaches OpenAI on a key of your own. The service creates the
  session on our key; relays the control and transcript events between your
  Mac and OpenAI; reads them to keep the record and to hand each spoken ask to
  Luke's judgment; drops the audio OpenAI reflects back, so neither your voice
  nor Luke's transits our service; keeps only the lines and the call record
  described under "Your account"; logs status and close codes, event names,
  the kind of any failure, and counts, never what was said or an error's own
  words; and counts each session's billed seconds once.
  Luke's judgment is a separate call to OpenAI's Responses API, made from our
  service on our key when you ask him something on a call, carrying the plan
  conversation's working memory: the saved plan, the conversation so far, and
  what the planning model read for it. Your Mac makes no such call. Our
  service makes one model call per request and stores and logs none of the
  request, the reply, or the encrypted reasoning in it; OpenAI keeps them
  under its own retention policy. A web search by the planning model or its
  research worker runs on OpenAI's own search. Every model call, request to
  count a call's tokens, fold of Luke's working memory, and notetaker note is
  counted in your daily usage. Each call carries a prompt cache key, a hash of
  the conversation's internal name from which no session id or title can be
  read, so a later call reuses the earlier calls' billing prefix; our service
  keeps it no longer than the request. A development build run from a
  checkout can write a local trace of this traffic when its developer asks; a
  packaged build cannot.
- OpenAI, for dictation. Pressing the microphone in a message box records
  it, in memory and never on disk, until you press ✓ or Enter (or for two
  minutes at most); ✕ or Escape discards the recording. It goes through our
  service, on your account, to OpenAI's transcription model on our key, with
  words the plan is likely to contain — its repository's name, its title, and
  the file paths it names — so they are spelled right. Only the text comes
  back, into the box at the caret, and it goes nowhere until you send it. Our
  service stores and logs neither the recording nor the text, and counts only
  the clip and its length in your daily usage; OpenAI keeps the request and
  its reply under its own retention policy.
- PostHog, for usage data and screen recordings from the Mac app. The counts
  go through our own service; the recordings go from Luke to PostHog directly.
- Sentry, for the anonymous exception, process-session, and native crash
  reports described above.
- Anthropic and OpenAI, for a coding agent. When you, or Luke on a call,
  start one on a plan, our service runs it in a Vercel Sandbox of its own with
  the plan's repository checked out, and calls the model chosen (or your
  default) and whatever model it picks for each worker it hands work to, which
  may be the other provider's: Anthropic for a Claude model, OpenAI for a GPT
  model, on your own key for that provider if you added one, and otherwise on
  ours. A call on your own key is billed to you by the provider, and if our
  service can no longer read your key the agent stops and asks you to replace
  it rather than switching to ours. Each call carries the plan's text, the
  agent's conversation so far, any files you attached, and what it read of the
  repository; the provider keeps it under its own retention policy. The
  agent's transcript — its words, reasoning summaries, and tool calls with
  their input (such as the few words it gives to describe a command) and
  output — is written to your account's conversation as described under "Your
  account". Archiving an agent stops a running turn and sets the agent aside;
  its transcript, with your files, and its pull request are kept, and you can
  bring it back. The sandbox has ordinary Internet access and runs the
  repository's own checks; the agent's `web_search` runs on its model
  provider's own search. The sandbox stops when a turn ends or you stop it,
  and its checkout, with the agent's changes, stays in a snapshot on the terms
  under "How the planning model reads your repository". Nothing of the
  sandbox reaches the screen recording.
- Anthropic, for titles. As a coding agent's turn completes, until it has a
  title and for its first three turns at most, our service asks a small
  Claude model, on our key whatever key the agent runs on, for a short title,
  sending your first message (for an agent started on the plan, the plan's
  text), your latest one, and the agent's latest answer, as text alone cut to
  2,000 characters each. A worker that a coding agent or Luke's planning model
  hands work to is titled from the whole task it was handed. The title is
  stored with the agent or worker; Anthropic keeps the request and its reply
  under its own retention policy.
- GitHub, through the Luke GitHub App, for a coding agent's work. The agent
  checks the repository out, pushes its branch, and opens a pull request with
  an installation token the App mints for that one repository, set at the
  sandbox's network boundary and never inside it; where the installation has
  accepted it, the agent also reads its pull request's checks and the logs of
  failed runs with that token, which land in its transcript like any other
  command's output. GitHub also tells our service, signed with a secret it
  shares with us, when a pull request or its checks change on a repository the
  App is installed on; our service reads only the kind of change and the
  repository's and branch's names from that message and keeps none of it,
  then, for up to ten of the newest agents on that branch, reads with its
  owner's GitHub token the pull request's number, title, link, state, checks,
  and size of change, and the branch's latest commit, and keeps them with the
  agent until the plan is deleted.
- Vercel Connect and Linear, if you connect Linear: Vercel Connect keeps
  Linear's token, and our service sends each Linear call, with its input, to
  Linear's MCP server, which keeps it under Linear's own policy.
- Vercel Connect and Notion, if you connect Notion: Vercel Connect keeps
  Notion's token, and our service sends each Notion call, with its input, to
  Notion's MCP server, which keeps it under Notion's own policy.
- Vercel Connect and Sentry, if you connect Sentry: Vercel Connect keeps
  Sentry's token, and our service sends each Sentry call, with its input, to
  Sentry's MCP server, which keeps it under Sentry's own policy.
- Vercel Connect and Slack, if you connect Slack: Vercel Connect keeps
  Slack's token, and our service sends each Slack call, with its input, to
  Slack's MCP server, which keeps it under Slack's own policy.
- Vercel, which runs our service and the sandboxes, and Neon, which hosts our
  database: everything our service keeps is stored with Neon and passes
  through Vercel. Luke's planning model, its research worker, and each coding
  agent and its workers also run as sessions on Vercel Workflow, which keeps
  each session's history (the messages, files, tool calls, and answers its
  model works from) so the session can pick up where it stopped. Deleting a
  plan or your account ends each of its sessions for good, a turn still
  running included. When a planning or coding-agent session ends, Vercel
  deletes that history at once, though the session's ids, status, and times
  may stay as long as Vercel's own retention. This holds for a session
  started on or after 13 October 2026; a session started before then, and
  the session of a worker either one hands work to, keeps its history under
  Vercel's own retention.
- GitHub, asked by your Mac itself and unauthenticated: to check for updates,
  carrying nothing about you, and for the picture of each repository owner
  the app names, an organization's logo or a person's avatar, carrying only
  the owner's name.

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
Mac. Our service keeps your account and, unsealed, your conversation in our
database, which Neon hosts, beside what earlier versions left there; a
plan's checkout and a coding agent's changes are held in a Vercel Sandbox and
its snapshot; usage counts and recordings are held by PostHog, and crash
reports by Sentry.

## Your choices

- Sign out of your Luke account to turn voice off.
- Delete any workspace file an earlier version of Luke left on your Mac;
  nothing reads it now. What earlier versions left on our service goes with
  your account.
- What you say to Luke on a call goes to that plan's conversation, fixed
  when the call opens and never moved afterwards.
- Luke listens through your microphone only while a call's microphone is on,
  or while a dictation into a message box is recording, which the box shows
  as a moving waveform with its time. The talk key opens it while held; a
  plan's microphone button, the call card's, or the microphone shortcut opens
  it until you press one again or press and let go of the talk key, and so
  does starting a new plan, which opens a call about it. macOS's microphone
  indicator is lit whenever the device is open: from the press, including
  while a new call connects, until OpenAI confirms it has stopped listening,
  within five seconds of the microphone going off. The stop key closes it too,
  and is the one key that also tells Luke to stop talking, while letting go of
  the talk key lets him finish. If Luke's key helper cannot start, the talk
  key reports presses alone, so one press opens the microphone and the next
  closes it, and the Keyboard shortcuts page says so.
- Delete your account from the Account section in Settings. This erases at
  once your account and everything our service keeps under it — among them
  your sign-in records and the GitHub and Google tokens we kept, your usage
  counts, preferences, and plan template, your pinned repositories, your plans
  with their history, whiteboards, coding agents, and inbox items and
  pictures, the conversation with its attached files, every call's record,
  your own API keys, Luke's record of your Linear, Notion, Sentry, and Slack
  connections, and everything earlier versions left there — and asks PostHog
  to erase your usage data and recordings, which does not reach a recording
  never attached to your account. Luke stops recording for the rest of the
  session, and starts again the next time you open it or sign in. Sentry
  reporting continues, and earlier anonymous crash reports cannot be
  identified as yours and targeted through account deletion. Deleting does not
  affect your Google, GitHub, Linear, Notion, Sentry, or Slack account, and
  does not revoke the Luke GitHub App (revoke it in GitHub's settings). It
  asks Vercel Connect to revoke the Linear, Notion, Sentry, and Slack grants
  it holds; if Vercel Connect cannot be reached, the account is deleted anyway
  and a grant stays until you revoke Luke in that service's own settings. It
  ends every session of yours on Vercel Workflow and, shortly after, deletes
  their sandboxes with the snapshots no other sandbox uses; the session
  history Vercel Workflow keeps goes as described under "Who we send it to",
  and anything stored only on your Mac stays there until you remove it.

## Google user data

Luke's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. We use what Google returns when you
sign in with it, your name, email address, and profile picture, only to
identify your account. It is not transferred, sold, or used for advertising.

## Contact

Email founders@stagereview.app with any questions about this policy.
