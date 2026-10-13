# Privacy

Last updated: 13 October 2026

Luke is a macOS app for planning a feature by voice. This policy explains
what we collect, who we send it to, and how to turn it off.

## What we collect

**On your Mac.** Luke reads no coding agent session on your Mac, and nothing
on it reads message history, file contents, or command output from your
Mac's own disk or from any other app, except a file you hand it yourself to
attach to a message for a coding agent, as described under "Files you attach
to a coding agent" below; the one transcript it shows is a
coding agent's that you started from Luke, read from our service. The planning
model reads a plan's code in a sandbox on our service, never on your Mac,
as described under "How the planning model reads your repository" below. The
only coding agents the Mac app lists are the ones started on a plan, from
its Start button, from New coding agent in its side panel, or by Luke on a
planning call, which our service runs in a sandbox of its own as described
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
short. Our service keeps those turns with the plan's planning conversation,
so when you open a plan, Luke on your Mac also reads them back from our
service, the newest twenty first and older ones as you scroll back through
the tab, and the tab shows them after a restart or a visit to another plan. Luke holds them in the panel's memory to show them, never in
the voice window and never on disk, and they go when you leave the plan or
quit Luke. The agent tabs and the Work tab, like the Transcript tab, are left out
of the screen recording described under "Screen recordings"
below. Your default model, effort, and context size for a coding agent are kept with your
account preferences on our service, chosen in Settings › Coding agents or by
the model you last started with.
A voice session on this Mac is a call about one plan, and it opens with
nothing of your coding agent sessions and no line of your conversation, from
here or from our service; what Luke knows when he answers a spoken ask he
reads on our service, from the plan and the record described under "Your
account" below. During the call, Luke's planning model can list
the plan's coding agents, read the last few turns of one's transcript, send
one a message it writes for you, which is kept in that agent's transcript as
yours, and start a new one; what it read and sent is kept with the plan's
planning conversation. What our servers keep
of a conversation is the record described under "Your account" below; a
fixture or evidence run keeps no conversation at all.

**Feature plans.** When you start a named plan, our service stores it under
your account: its name and the plan's one Markdown document, which begins as
a copy of your plan template and is written by the planning call's notetaker
as you talk, by the coding agents started on it, and by you,
when you edit a section of it in Luke or restore an earlier version. An edit you make is sent to our service
as you pause typing and when you finish, and saved into the plan as the
notetaker's notes are; words you have typed but not yet saved stay in Luke's
memory on your Mac, never on disk. It is
stored as written, bound to your account and readable by our own operators,
the same way the conversation described below is. A save
replaces the document, and our service keeps the
plan's history: the plan's content as it stood after each revision, where
saves one writer makes close together count as one revision, who
wrote it (you, editing a section or restoring an earlier version, with which
one; the notetaker, on which call; or which coding agent), and when,
stored and readable the same way as the document, with no limit on how many
revisions a plan keeps, and who last changed each section of the plan, and
when, so Luke can say so beside it. Luke on your Mac remembers, for each plan,
the time of its newest save when you last had it open, in its own storage on
your Mac and nothing of the plan's words, to show which sections changed
since. A coding agent's saves are also kept as the notes it
took, the last fifty, so Luke can tell you what an agent changed. Deleting a
plan removes it at once, with its history, the record of each coding agent
started on it and the copy of the plan, or the task you wrote in its place,
that agent was handed, and its inbox, and marks the plan's conversation and each agent's
transcript deleted, removed thirty days later. It does not remove the record
of the plan's calls described under "Your account" below, which stays until
you delete your account. Deleting your account removes
every plan. A coding agent at work when you delete its plan is not stopped
by the delete. Pinning or archiving a plan stores only when you did it, and
deletes nothing.

**Your plan template.** The template a new plan starts from is kept with
your account preferences on our service, as you write it in Settings › Plan
template, up to 20,000 characters; until you write one, Luke uses a built-in
template. A new plan's document begins as a copy of it, and no model reads
the template itself. Deleting your account removes it.

**Pinned repositories.** When you pin a repository in the sidebar, our
service stores its name under your account, with when you pinned it, so the
pin follows you to every Mac you sign in on. Unpinning it deletes that record,
and deleting your account removes them all.

**A plan's inbox.** When a coding agent you started on a plan needs a
decision from you, or something only you can do such as changing a setting
on GitHub, it posts an item to the plan's inbox on our service: its title,
the context the agent wrote for it as Markdown, links, and references to
lines of the agent's repository (a path, the lines, and the commit it read
them at, never the lines themselves), and the way it asks to be answered, with any options or form fields it offers, stored under your
account and readable by our own operators, like the agent's transcript.
An item may carry a picture the agent took in its sandbox, such as a
screenshot of a page it rendered from your repository, with a description
of it the agent wrote, up to 300 characters: our service reads the
file from the sandbox, keeps the image itself, up to 1.5 MB, in our database
beside the item under your account, and serves it only to Luke signed in as
you; our operators who can read the item can read its pictures. A picture is
kept as long as the item names it: the agent posting the item again without
it deletes it, and so does deleting the plan or your account. The agent can
change or withdraw its items, and our service keeps each one
as it last stood. When you answer an item in Luke, your Mac sends your answer
and any note you write to our service, which stores it with the item and,
where the agent asked to hear back, hands it to the agent as one of your
messages, kept in its transcript. While you are signed in, Luke on your Mac
reads the items waiting on you across your plans, to count them in its
sidebar and on its Dock icon, and an item posted while Luke's window is
behind is named, by its plan, its agent, and its title, in a Mac
notification, which macOS shows and keeps as it does any app's; so is a
coding agent's turn ending, by its plan, its agent's title, and whether it
finished or failed, or the number of its branch's pull request. Deleting the
plan, or your account, deletes its items.

**Files you attach to a coding agent.** In a coding agent's message box, or
the task you start one with, you can attach files you pick with +, drop on
it, or paste: images, PDFs up to 3 MB, and text files up to 100 KB, up to
ten files and 3 MB a message. A PNG, JPEG, or WebP of up to 1.5 MB is sent as
it is; any other image, or a larger one, is first made into a smaller WebP on
your Mac. Luke on your Mac reads only the files you hand it, and sends our
service each one's contents, with whatever details the file carries inside
it, such as where and on what a photo was taken, and its name, never where it
was on your Mac. Our service sends them to the agent's model with your
message and again with each later call the agent makes, copies each image and PDF into the agent's sandbox, and keeps them in
the agent's transcript, stored as sent and readable by our own operators like
the rest of it, except that the first message of an agent you start on a task keeps
an image or PDF by its name alone. They go when the transcript does; the
sandbox's copy stays in its snapshot, and the agent's session history keeps
them, on the terms described under "Who we send it to" below.

**Your own API keys.** If you add an Anthropic or OpenAI API key of your
own in Settings, your Mac sends it once, over HTTPS, to our service, which
first checks it with that provider by asking for the provider's list of
models, a request that costs nothing, and keeps it only if the provider
accepts it. Our service stores it under your account encrypted with
AES-256-GCM, under a key drawn for it alone that is itself encrypted under a
server-only secret held outside the database, so a copy of our database
alone cannot read it; our operators who hold both could. We keep beside it
which provider it is for, its last four characters with the `sk-` prefix and
the word after it where it has them (such as `sk-ant-…abcd`), when you last
saved it, and whether the provider last accepted it, refused it, or said it
was out of credit, or our service could no longer read it, and when, which a
coding agent's call on it updates. Only
coding agents and their workers use it: Luke's planning model, his voice,
his notetaker, dictation, and the titles described under "Who we send it to"
below always run on our keys. Neither your Mac nor any answer from our service ever holds the key
again after you save it, and we never log it or send it to our analytics,
crash reports, or screen recordings. Removing it in Settings deletes it, and
deleting your account removes it.

**A plan's whiteboard.** Each plan has a whiteboard that Luke's planning model
and you can both draw on. Our service stores it with the plan, under your
account: every shape, arrow, line, freehand stroke, and piece of text on it,
with where each stands, and the planning model's latest drawing. It is stored
as drawn and readable by our own operators, like the plan's document. Luke on
your Mac sends our service the whole board each time it changes, and, with a
save that holds a new drawing of the planning model's or that it is waiting
to look at, a picture of the whole board as your Mac draws it, at most 1,200
pixels a side, which our service keeps with the board in place of the last
one. The planning
model reads the board as text at the start of each of its turns, and may look
at that picture to check what it drew, which sends the picture to the model;
our service does not copy it into the planning conversation, though the
model's session history described under "Who we send it to" below may keep it. Each drawing
call it makes, with what it drew, is stored in the plan's planning
conversation, under the terms described for that conversation. You cannot
put an image or a file on the board. Deleting the plan deletes its whiteboard.

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
while a command runs. Each command, the few words the model gives to describe
it, and up to 20,000 characters each of its output and error text are stored with the plan's planning conversation,
under the terms described for it; deleting the plan deletes them with it.
The checkout stays in the sandbox between commands and, once the sandbox is
stopped for idleness, in a snapshot of it that Vercel keeps until it expires
thirty days after its last use. Nothing written in the sandbox reaches your
repository.

**Code on screen during a planning call.** During a planning call, Luke shows
code from the plan's GitHub repository in the plan's Code tab. When
the planning model wants to show you code, it names a file and a range of
lines, and our service reads those lines from its own checkout of the
repository, in the same sandbox the planning model reads the repository in.
The file path, the line numbers, and the lines themselves (at most 200 lines,
each cut to 400 characters) are stored with the plan's planning conversation,
with the planning model's note on why it showed them (at most 280
characters, which the Code tab draws above the lines), and our service sends
them to your Mac, which draws them. Nothing is read
from your Mac's disk. The service refuses a path outside the checkout and
never reads a file named `.env` or starting with `.env`. Our service tells the
voice model the file path and line numbers on screen, so Luke can refer to
them. The Code tab shows every code Luke showed on the plan, and keeps
showing it after the call: when you open the plan, Luke on your Mac reads
back the code shown on it from what our service keeps with the plan's
planning conversation, by the same rules (nothing the service refused, and no `.env` file, is read back),
and holds them in the panel's memory, never on disk, until you leave the
plan or quit Luke. They are never part of the plan's document.

**A whole file opened from a snippet.** Each snippet in the Code tab can
open the whole file it came from in a File tab. Outside a call there is no
checkout to read, so our service reads the file from GitHub instead, at the
head of the repository's default branch, through the Luke GitHub App: it
confirms you still reach the plan's repository, mints a token for that one
repository with read access to its contents, and reads the file with it. The
token stays on our service: it is used for that one read and never sent to
your Mac, written to a log, or kept. The same rules apply as for code on
screen: a `.env` file is never read, a link, a folder, a file over a
megabyte, or one that is not text is refused, and each line is cut to 400
characters. The file is read a window of at most 500 lines at a time as you
scroll, is not stored by our service, and is held by Luke on your Mac only
while its tab is open, never on disk, except that copying or downloading the
file reads it whole, up to the same megabyte, its lines uncut, and a download
is written where you save it. The File tab's tree lists the repository's
folders and file names the same way, read from GitHub through our service as
you open them, not stored by our service, and held by Luke on your Mac in
memory only; a `.env` file's name may be listed there, though the file is
never read. Because it is read from GitHub as it
stands now, it may differ from the lines Luke showed if the file has changed
since. An inbox item's reference to lines of the repository is read the same
way, at the commit the agent named rather than the default branch's head,
both for the lines drawn on the item and for the File tab it opens: nothing
of the file is stored with the item, or by our service.

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
applies the notes that call answers to that one plan: a point added under a
heading (adding the heading where the plan lacks it), a phrase replaced, or
the lines a phrase names removed. It is told which
sections you last wrote yourself, so it adds to your words rather than
rewording them, and Luke's planning model is told the same. It runs only during a
planning call you started and only for that call's plan, each run is counted
in your daily usage as Luke's turns are, and a run that fails writes nothing.
Nothing it reads or answers is kept
beyond the saved plan and its history, said aloud, or shown anywhere but the
plan itself, and
OpenAI keeps the request and its reply under its own retention policy.

**Your account.** Signing in with Google or GitHub gives us your name, email
address, the address of your profile picture, and which of the two you used. Signing in with GitHub is your
authorization of the Luke GitHub App: the token GitHub gives us reaches only
the repositories where you have installed the App and that you can already
see, with the App's permissions (reading a repository's details, reading and
writing its contents and pull requests, reading its checks, commit statuses,
and Actions runs with their logs where the installation has accepted them,
and reading your
email addresses),
and it reaches none until you install the App. We keep that token and the
refresh token that renews it sealed under a server-only secret, read them
only on our service, and never hand them to your Mac, a browser, or anyone
else; they go when you delete your account, and you can revoke the App's
access at any time in GitHub's settings under Applications. An account that
signed in with GitHub before the App may still hold the earlier sign-in's
`repo` permission, which Luke no longer uses; revoke it in the same place.
Signing in with Google leaves us Google's sign-in tokens, which we keep on
our service and use for nothing after the sign-in. Installing the App stores
nothing about you with us: which repositories it can see is read from GitHub
when you choose one. We also keep the records that keep you signed in, each
with the network address and the browser or app it was signed in from, and
a daily count of what you used on our service: one for each voice session you
opened, each model call Luke's planning model or its research worker makes,
each web search, each run of the notetaker, and each clip you dictated,
counted together, and how many seconds you dictated.
Luke's own maintainers can see that record — your name, email address,
profile picture, which sign-in you used, whether you are an administrator,
when you joined, when you were last active, and your daily
counts — on an admin page of our site that only an account we have marked as an
administrator can open; nothing you type, say, or run in a session appears on
it. The service also keeps your account's conversation with Luke. When Luke runs a turn for you on our service, that
turn writes rows to our database: your ask as it was given; Luke's reply, the
summaries of his reasoning, and each tool he called with its input and its
result; and the turn's model and effort, its token counts, and when it was
queued, started, and ended, and how. Rows from earlier versions may also hold
the ids of OpenAI's responses. When you speak with Luke through
your account, what you said is kept as your line and what his voice said as
his — an answer he gave without running a turn, what he said before and after
one, a reply he read aloud — each written once it has settled,
so the record holds the words you actually heard beside the turns he
ran and the messages he read from. Each call also keeps a record of its own:
the plan it was about, OpenAI's id for the session, when it started and
ended, why it ended, the voice model it ran on, the seconds it was billed (or
our own count of them where OpenAI gave none), and each line said on it, by
whom, with when in the call it was said; the plan's Transcript tab shows it.
These rows are not sealed: they are stored as written, and our own operators
can read them. They stand until you delete your account, which removes them at
once; the conversation of a plan you delete, and the transcript of each
coding agent started on it, are marked deleted and removed thirty days later.
Deleting a plan does not remove the record of its calls: Luke no longer
shows it anywhere, but it stays in our database until you delete your
account.

**Linear, if you connect it.** Connecting Linear in Luke's settings signs you
in to Linear in your browser through Vercel Connect, which stores Linear's
token for your account, encrypted, and renews it. Luke's service never writes
the token down: it asks Vercel Connect for it when an agent uses Linear,
holds it in memory while it is used, and sends it only to Linear's MCP
server, never to your Mac, a model, or a coding agent's sandbox. We keep only
the state of your connection (waiting for sign-in, connected, or expired) and
when it last changed.
While you are connected, Luke's planning model and its research worker, and every coding
agent and its workers, can read and change what your Linear account can,
through Linear's own MCP server, without asking you first. What Linear answers
goes to the model that made the call, and each call, with its input and
everything Linear answered, is written to the plan's conversation or the
agent's transcript like any other tool call, under the terms described above.
Disconnecting stops Luke using it from each agent's next step, removes the
connection's record, and asks Vercel Connect to revoke the grant; what agents already changed in
Linear, and the record of it, stays. Deleting your account removes the
connection's record, so Luke can no longer use it, but does not ask Vercel
Connect to revoke the grant: disconnect Linear first, or revoke Luke's access
in Linear's own settings.

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
document, a caption of what you or Luke said, your name and email
address, and anything you type into a field all appear as blocks, and so do
the labels, descriptions, and picture addresses a page carries for itself.
Some parts are left out whole, as a second line: the
feedback form, since a screenshot you attach to it is a
picture of your screen and could carry another app's words; a plan's name;
the plan's document while you edit it; a plan's whiteboard, transcript,
Work tab, Code tab, and File tabs with their tree; the Inbox, with its
pictures; each coding agent's tab and its message box, and any file you
attach there; code drawn in a transcript; a plan's version history and the
earlier version of it you are viewing; the API keys and Plan template pages
of Settings; and the cards that open over a row on hover. The whiteboard draws its
words as pixels, which the text masking cannot reach, so leaving it out is
its only line, and recording what a canvas draws is switched off. Luke does
not report what you clicked.

Recording starts when Luke opens, before you sign in, so it covers the
signed-out panel and the sign-in, from just after the panel first draws. A recording that begins
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

**Feedback.** If you use the feedback form, we receive what you typed, any
screenshots you attached, and — unless you untick "Include my name and email"
— the name and email of the account you are signed in with; they reach us
only when you press Send.

## Who we send it to

- OpenAI, for voice and for Luke's own judgment. A voice session is one
  continuous conversation: while your microphone is on — while you hold the
  talk key, or from a press of a plan's microphone button, the call card's,
  or the microphone shortcut, or from starting a new plan, until you press one
  of those again or press and let go of the talk key — everything the
  microphone hears streams to OpenAI. When it goes off, Luke tells OpenAI at once to stop listening, and closes the microphone as
  soon as OpenAI confirms, within five seconds; Luke can still speak into a
  session whose microphone is closed. There is no way to type to Luke; every
  ask is spoken. A Mac's session is a call about one plan, and opens with
  nothing of your coding agents, though Luke can read and message them during
  it, as described above. What you say and what Luke says in a
  call is written to your account's Conversation by our service, as
  described under "Your account" above, and kept nowhere on your Mac. When you use voice through your
  Luke account, your Mac reaches OpenAI through our own voice
  service, which
  creates the session on our key, relays the control and transcript events
  between your device and OpenAI, reads them on our side to keep the record and
  to hand each spoken ask to Luke's judgment (no device of yours answers a
  spoken ask itself), drops the audio OpenAI
  reflects back so neither your voice nor Luke's transits our service, keeps of the
  exchange only the lines and the call's record described under "Your
  account" above, logs status and close codes, event names, and counts rather
  than what was said, though an unexpected failure to write the record is
  logged with its error, and counts each session's billed seconds once.
  Every voice session is opened this way, through our service on your
  account: nothing on your Mac holds or is handed a credential for OpenAI,
  and your Mac never reaches OpenAI on a key of
  your own. No session opens on its own: a call opens only when you press
  the talk key or the microphone on a plan, or when you start a new plan,
  which opens a call about it with the microphone on where macOS already lets
  Luke use the microphone and no other call is open.
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
  that travels in it. A web search the planning model or its research worker
  makes runs on OpenAI's own search. Each call is counted in your daily usage.
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
- OpenAI, for dictation. When you press the microphone in a message box,
  your Mac records the microphone, in memory and never on disk, until you
  press ✓ or Enter (or for two minutes at most), then sends the recording
  through our service, on your
  account, to OpenAI's transcription model on our key, together with words
  the plan is likely to contain — its repository's name, its title, and the
  file paths it names — so they are spelled right. Only the text comes back,
  into the box at the caret, and it goes nowhere until you send it. Our
  service keeps neither the recording nor the text: it stores and logs
  neither, and counts only the clip and its length in your daily usage. OpenAI keeps the request and its reply under
  its own retention policy. ✕ or Escape discards a recording before it is
  sent.
- PostHog, for usage data and screen recordings, from the Mac app. The
  counts go through our own service; the recordings go from Luke to PostHog
  directly.
- Sentry, for the anonymous exception, process-session, and native crash reports
  described above.
- Anthropic and OpenAI, for a coding agent. When you, or Luke on a call,
  start a coding agent on
  a plan, our service runs it in a Vercel Sandbox of its own, with a copy of
  the plan's GitHub repository checked out in it, and calls the model you
  chose, or your account's default, and the model it picks for each worker it
  hands work to, which may be the other provider's, directly on your own key for that
  provider if you added one in Settings, and otherwise on ours: Anthropic's
  for a Claude model, OpenAI's for a GPT model. A call on your own key is
  billed to you by that provider, and if our service can no longer read your
  key the agent stops and asks you to replace it rather than switching to
  ours. Each call carries the plan's
  text, the agent's conversation so far, any files you attached, and what it
  read of the repository,
  and the provider stores the request and its reply under its own retention
  policy. The agent's transcript, its words, reasoning summaries, and tool
  calls with their input, such as the few words it gives to describe a
  command, and their output, is written to your account's Conversation by our
  service, as described under "Your account" above. Archiving an agent stops
  its turn if one is running and sets it aside; its transcript, with any
  files you attached, and its pull request are kept, and you can bring it
  back. Nothing of the sandbox
  reaches the screen recording. The sandbox has ordinary Internet access, and
  the agent runs the repository's own checks in it; its `web_search` runs on
  the model provider's own search, so a search goes to the provider the agent
  is calling. The sandbox is stopped when the agent's turn ends or you stop
  it, and its checkout, with the agent's changes, stays in a snapshot of it
  that Vercel keeps on the same terms as the planning checkout's, described
  under "How the planning model reads your repository" above.
- Anthropic, for titles. As a coding agent's turn completes, until it has a title
  and for its first three turns at most, our service asks a small Claude
  model, on our key whatever key the agent runs on, for a short title,
  sending your first message to the agent (for
  an agent started on the plan, the plan's text), your latest one, and the
  agent's latest answer, each as text alone and cut to 2,000 characters. A
  worker that a coding agent or Luke's planning model hands work to is titled
  the same way from the whole task it was handed. The title is stored with the
  agent or worker, and Anthropic keeps the request and its reply under its
  own retention policy.
- GitHub, through the Luke GitHub App, for a coding agent's work. The agent
  checks the repository out, pushes its branch, and opens a pull request
  with an installation token the App mints for that one repository, set at
  the sandbox's network boundary and never inside it; what GitHub sees is
  the App acting on a repository you gave it. Where the installation has
  accepted it, the agent also uses that token to read its pull request's
  checks and the logs of failed runs, which land in the agent's transcript
  like any other command's output. GitHub also tells our service, signed with a secret it
  shares with us, when a pull request or its checks change on a repository
  the App is installed on; our service reads only the kind of change and the
  repository's and branch's names from that message and keeps none of it,
  then, for the newest agents on that branch, ten at most, reads each one's
  pull request's number, title, link, state, checks, and size of change, and
  its branch's latest commit, with its owner's GitHub token, and keeps them
  with the agent, which goes when the plan does.
- Vercel Connect and Linear, if you connect Linear. Vercel Connect keeps
  Linear's token for your account; our service asks it for that token when an
  agent uses Linear and sends each Linear call, with its input, to Linear's
  MCP server, which keeps it under Linear's own policy.
- Vercel, which runs our service and the sandboxes described above, and
  Neon, which hosts our database: everything our service keeps, as described
  above, is stored with Neon and passes through Vercel. Luke's planning model,
  its research worker, and each coding agent and its workers also run as
  sessions on Vercel Workflow, which keeps each session's history (the
  messages, files, tool calls, and answers its model works from) so the
  session can pick up where it stopped. Deleting a plan or your account does
  not remove that history; Vercel keeps it under its own retention.
- GitHub, to check for updates. These requests are unauthenticated and carry
  nothing about you.
- GitHub, for the picture of each repository owner the app names, an
  organization's logo or a person's avatar. Your Mac asks for them itself,
  unauthenticated, and each request carries only the owner's name.

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
service, in our database, which Neon hosts; usage counts and recordings by
PostHog; and crash reports by Sentry.

## Your choices

- Sign out of your Luke account to turn voice off.
- Delete any workspace file an earlier version of Luke left on your Mac;
  nothing reads it now. What earlier versions left on our service goes with
  your account.
- What you say to Luke on a call goes to that plan's conversation, fixed
  when the call opens and never moved afterwards.
- Luke does not listen through your microphone except while a call's
  microphone is on, or while a dictation into a message box is recording, which the
  box shows as a moving waveform with its time and stops at ✓, ✕, Enter, or
  Escape. The talk key opens the microphone while it is down and closes it
  when you let go. A plan's microphone button, the call card's, or the
  microphone shortcut opens it until you press one again or press and let go
  of the talk key, and so does starting a new plan, which opens a call about
  it. macOS's microphone indicator is lit whenever the device is open: from
  the press, including while a new call connects, until OpenAI confirms it
  has stopped listening, within five seconds of the microphone going off. The stop
  key closes it too, and is the one key that also tells Luke to stop talking,
  while letting go of the talk key lets him finish. If Luke's key helper cannot start, the key reports
  presses alone, so one press opens the microphone and the next closes it,
  and the Keyboard shortcuts page says so.
- Delete your account from the Account section in Settings. This erases your
  account and everything our service keeps under it at once: among them your
  sign-in records and the GitHub and Google tokens we kept, your usage
  counts, your preferences and plan template, your pinned repositories, your
  plans with their history, whiteboards, coding agents, and inbox items and
  pictures, the conversation our service kept with its attached files, the
  record of every call, any API keys of your own you added, Luke's record of
  your Linear connection, and
  everything earlier versions left there
  (described under "What earlier versions left on our service"), and asks PostHog to erase your usage data
  and recordings. It does not reach a recording that was never attached to your
  account, as described above. Luke stops recording for the rest of the
  session, and starts again the next time you open it or sign in. Sentry
  reporting continues after deletion, and prior anonymous crash reports cannot
  be identified as yours and targeted through account deletion.
  Deleting does not affect your Google, GitHub, or Linear account. It does
  not revoke the Luke GitHub App, which you can do in GitHub's settings, or
  the grant Vercel Connect holds for Linear, so disconnect Linear first or
  revoke Luke in Linear's own settings. A sandbox snapshot stays until Vercel
  lets it expire, and the session history Vercel Workflow keeps stays, as
  described above, and anything stored
  only on your Mac stays there until you remove it.

## Google user data

Luke's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. We use what Google returns when you
sign in with it, your name, email address, and profile picture, only to
identify your account.
It is not transferred, sold, or used for advertising.

## Contact

Email founders@stagereview.app with any questions about this policy.
