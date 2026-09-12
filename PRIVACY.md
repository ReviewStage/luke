# Privacy

Last updated: 11 September 2026

Luke is a macOS app that watches your coding agent sessions, with companion
iOS and Apple Watch apps for the cloud sessions your account can see. This
policy explains what we collect, who we send it to, and how to turn it off.

## What we collect

**On your Mac.** Luke reads the session files your coding agents already write,
using the session title, status, repository, branch, model, current tool,
errors, and the tool it is running. It keeps none of these fields in a file
of its own; what it does keep is the working memory described below. For a
session running on your Mac whose agent keeps a transcript this build can read
(Claude Code, Codex, and OMP today), Luke also reads that session's own
transcript file — the file its agent already writes, which Luke never writes
to — so he can notice what changed and tell you about it. He reads it at three
moments: when an agent's hook says a turn just ended, on his own periodic look
at the sessions that are working or waiting, and when you ask him about a
session. On the first two he reads what each transcript gained since he last
looked, up to the last 20,000 characters of new text per session per look,
and may also read one session's recent tail, up to its last 60,000
characters, while deciding whether there is anything to tell you; when you
ask, he reads the same bounded tail. Each observed session is followed by a
conversation of Luke's own, kept inside his application data: that
conversation is the one that reads the session's transcript and briefs you
about it, and no other conversation of his — the main one included — is
handed those excerpts. What the main conversation
learns of them is a short notice in Luke's own words and counts (which
session a turn looked at, what he briefed, how many actions he took), never
the transcript's text. What he reads is written down first — the new text, with the
session's title and status and the position it was read to — in that
conversation's own inbox on your Mac, so that a turn interrupted by a
throttle, a failure, or a quit picks it up rather than rereading or losing
it; an entry leaves the inbox when a turn has consumed it, and the inbox
holds at most 20 entries. What he reads is sent to a model as described under
"Who we send it to", and what he keeps of it lives under his working memory's
own lifetime, described below, one memory per conversation. For a Conductor
session, which keeps no transcript on your Mac, the same "read the recent
tail" ask reads the newest page of that chat's conversation from Conductor
instead — your own messages and the agent's replies, not its tool activity —
through our own service, under the synced copy of the Conductor key you gave
the Mac app (see "Provider API keys" below), only for a session Luke was just
shown, and only inside a turn: one you opened, or one a status change on that
chat woke; the periodic look itself reads no message of any chat. Our service
stores nothing of that page, and what he reads is held in that turn's working
memory on your Mac and stored nowhere else. Nothing
else reads message history, file contents, or command output. If you run
agents inside the Herdr terminal manager, Luke also asks Herdr's own
command-line tool which of those sessions it holds, so their rows can say so;
that read never starts Herdr, reads no terminal output, and sends nothing
anywhere. If you run Claude Code sessions in the Claude desktop app's Code tab,
Luke also reads that app's own list of the sessions it holds — each one's
title, whether you archived it, and the id the app opens it by — so their rows
can say which app holds them and open there; that read opens no transcript and
sends nothing anywhere. It stays on your Mac unless a feature below sends it.

**Your conversation with Luke.** Luke keeps the conversations you have with
him — what you said, what he spoke or announced, the actions he took at your
request, and the asks he is still working on — in a database on your
Mac, so they are still there the next time you open him. The Conversation tab
draws a different record: the conversation Luke's own service keeps for your
account, read by every Mac you sign in on, so two Macs on one account show
the same thread. A signed-in Mac asks the service every few seconds what has
changed and reads only what did, and it draws the 200 most recent turns; that
is what is shown, not what is kept. A thumbs up or down you give one of Luke's
messages there is written to the same service as a rating event beside that
message, naming the verdict and the Mac it came from, so it shows on every
device signed in to your account, including the next time you open Luke; a
second verdict is a second event, and the newest is what every device shows.
Pressing thumbs down also offers the feedback composer, prefilled with that
message and your ask before it, and nothing of it leaves the Mac unless you
press Send. What the service keeps of it is described under "Your account"
below.
Every entry on your Mac stays in its database until you clear the conversation or the
housekeeping described below removes it. Beside the Conversation, Luke keeps a transcript
of each conversation's turns in the same database: every input the model was
shown and every point at which his working context was folded. The transcript
is a record, not a limit: folding the context changes what the model sees
next and erases nothing here. The 20 most recent Conversation lines, each cut to
400 characters, ride into a conversation as context, beside the working
memory. The same 20 lines, in their roles, are also placed into each voice
session when it opens, beside a summary of the coding agent sessions on your
screen (their titles, status, and branch, as the rows draw them), so the voice
can follow what was just said and what is on your desk; while a session
stands, that summary is sent again as quiet context whenever it changes. A thread you open as temporary is held in memory alone and is gone
when Luke next opens; nothing said in it is remembered automatically. What
our servers keep of a conversation is the record described under "Your
account" below; a fixture or evidence run keeps no conversation at all.

**Luke's workspace.** Luke keeps a small set of Markdown files of his own on
your Mac, under his application data (`agents/main/workspace`): his operating
instructions, his identity, stable facts about you, curated
notes, and first-run setup notes, plus dated notes under `memory/`. He seeds any file that is missing and never
overwrites one that exists, so you may edit them freely. The files are read
into the standing instructions of every call he makes (each cut to 20,000
characters and the set to 60,000), so their contents travel to OpenAI with his
working memory as described below; dated notes travel only when he reads one
or when a conversation starts fresh. Luke may edit these files himself through
his own tools, in any of his turns, and nothing else on your machine: a
coding agent's transcript or session state is never written, and a write whose
arguments are malformed is refused rather than filled in. When Luke runs a
turn for you on our service, that turn reads the same set of files from rows
in our database instead, one row per file per account: seeded with the same
defaults the first time a turn runs for you, composed into the standing
instructions the turn runs under, bounded the same way, and edited only
through Luke's own workspace tools there. The file's name is stored in
the clear and its contents are sealed under a key only our service holds,
each row bound to your account so it cannot be opened under another. Those
rows are untouched by clearing the conversation and are removed when you
delete your account.

**Luke's working memory.** For each conversation Luke keeps a working memory
of his own turns in the same database, in its own tables — main's, each
private thread's, and each observed session's: the model's record
of what he read, said, and did — the transcript excerpts described above, the
position he last read each transcript to and the position he last wrote one
down to, the inbox of excerpts written down and not yet read, a record of each ask you made and
how it ended, and a receipt for each action he took at your ask. When that
record grows long, Luke folds its older part: he asks the model for a written
summary of it, with no tools offered on that call, and keeps the summary in
place of the older part, as words of his own. The summary is still derived
from your sessions and your conversation and lives under the same rule as the
rest. The folding is Luke's own decision, made when the record nears the
model's window or the size a request may be; OpenAI is not asked to compact
the record itself, and an encrypted compaction item an earlier version of Luke
stored is kept and replayed as it was but never asked for again. The whole
record is one generation, and a generation does not reset on its own, on the
terms OpenClaw's sessions keep: it stands, summaries included, until you clear
the conversation, and an old one is loaded whole however long ago it began. A
generation holds at most 200 asks: the oldest finished
asks go first once their endings are in the Conversation, and when nothing can go
Luke declines a new ask rather than growing the record.

**Work Luke delegates to himself.** A conversation of Luke's may hand a task to
a child: another conversation of the same Luke, kept in the same database
under the same rules, that does the one task it was given and reports back.
A child starts with an empty working memory unless the conversation that
asked chose to fork its own into the child, in which case the child begins
with a copy of that conversation's working memory as it then stood, and never
with more than a bounded amount of it. A child reads the same sessions and
runs the same tools as any conversation, under the same policy less the tools
OpenClaw's design keeps from children, and its calls to OpenAI are the same
calls described below. The record of each child — what it was asked, when it
began and ended, and its final reply — and the record of that reply's
delivery back to the conversation that asked are kept in the database beside
everything else; a reply that could not be delivered is kept for seven days
and then discarded. A child's conversation is archived an hour after it ends
and lives under the same retention as every other conversation. Nothing a
child does reaches you except through the conversation that asked for it.

The Conversation tab's one control, **Clear**, asks Luke's service to clear
your account's conversation: nothing is erased at once — the conversation is
marked deleted, a new empty one is opened in its place, every Mac on the
account stops showing it on its next read, and the service removes the
marked conversation thirty days later. A Clear the service did not take
leaves the thread standing and says so. Once the service has taken it, the
same press also removes the conversation's lines, transcript, and working
memory from the database on your Mac, writing them first, in the same step,
into a compressed recovery archive kept on your Mac under Luke's own data (a
`.jsonl.deleted.<time>.zst` file, and until it is written to disk, a copy
inside the database); a copy not yet written is written at the next launch.
Nothing in the app reads an archive back yet; it stands on your Mac for you
alone. Clearing never touches the separate things Luke remembers about you,
described next, and never touches your agents' own files.

Luke also tidies this storage on his own, on the terms OpenClaw's session
store uses: a conversation untouched for 30 days, and a thread idle for 7, is
archived in place and keeps everything, and nothing is removed outright. He
keeps at most 5,000
conversations on the active list, archiving the longest untouched first, and
holds the database, its log, and the recovery archives together under 10 GiB
on your Mac: past that he removes the oldest recovery archives and then
permanently deletes conversations his own cap had archived, oldest first,
never one you archived, pinned, or are talking in, and never the main
conversation, until the total is back under 8 GiB, and tells you what
protected data left it above. Recovery archives do not expire by age.

The database lives under Luke's own application data, in a folder of its own
per agent (`agents/main/agent.sqlite`, with recovery archives beside it under
`archives/`), and it is written from one place: a worker thread of Luke's
own, so nothing else on your Mac and no other part of Luke writes it. Earlier
versions of Luke kept the conversation, the working memory, and the things he
remembers about you in three files beside your settings. Those files are no
longer read or written, so that conversation, that memory, and those
remembered things start over; the files stay where they were until you remove
them.

Luke's runtime runs inside the app, and can run on a server you connect to
instead; either way it holds your settings and the encrypted credentials
(decrypted where it runs, under the same Keychain entry), your account's
session, your conversation and its memory, and the observation of your
sessions and calendars, while the part that draws listens, speaks, holds the
keys, and asks the runtime for everything else. Nothing
about you crosses that boundary that the panel did not already draw; no
stored key, token, or account secret travels in any answer or event, and the
voice window is handed no credential at all — the runtime opens each voice
session itself and hands the window only the connection answer it needs to
hear and be heard. Quitting Luke cancels
what was running and writes down what did not finish rather than finishing it
on paper. The three things the app still does on this machine at the runtime's
ask are opening an address you or Luke asked to open, carrying an action to the
panel, and running the Calendar helper behind macOS's own consent dialog.

**Things Luke remembers about you.** During a conversation you start, Luke may
silently save a concise preference, personal fact, goal, or recurring constraint
that looks useful later. He skips temporary details and uncertain guesses, never
saves credentials, and saves sensitive facts only when you explicitly ask. Each
one is a line of `USER.md` in his workspace on your Mac, under a "Remembered"
heading, so the file you can read and edit is the record itself: at most 32 such
lines stand, they do not expire, and a line you edit or add by hand is taken up
the next time Luke reads the file. Beside the file, the same database keeps only
bookkeeping about each line — an id Luke can name to correct or forget it, when
it was written, and whether it came from you, from Luke, or from the list an
earlier version kept in the database — and that list, if one was found, was
moved into `USER.md` once under the same ids and is not written any more. The
iOS app keeps no such memory and does not read the Mac's. When Luke runs a
turn for you on our service, the facts he remembers in it are rows of their
own in our database instead, their words sealed the same way as his workspace files
there and bound to your account; a changed fact replaces the one it corrects,
clearing the conversation does not touch them, and they are removed when you
delete your account. You can ask Luke what
he remembers, correct something, or tell him to forget it. They travel with the
rest of Luke's working memory when he thinks, so he can personalize replies:
directly to OpenAI on your own key if you entered one, or through our own
service on our key when you use Luke through your account, on the same terms as
the rest of that call — one model call per request, and nothing of it stored or
logged by our service. They are never sent to a coding-agent provider or a
tracker, and they are never used to decide anything on your behalf.

**Luke's notebook index.** So that Luke can find what his workspace files say
without reading them all into every call, the same database keeps a search
index over them: `MEMORY.md`, `USER.md`, and the notes under `memory/`, cut
into passages, each passage's text and a numeric embedding of it. The index is
derived and disposable — it is rebuilt from the files whenever one changes, and
holds nothing the files do not. The embeddings are made by OpenAI's embeddings
model: on your own key if you entered one, or through our own service on our
key when you use Luke through your account, where one request carries only the
passages that changed and our service keeps and logs none of them. Without a
key or an account the index still works by keywords alone, and Luke's answers
say when a search ran that way. Luke's own conversations are never embedded or
indexed: when he looks for something you said in an earlier conversation, he
reads the lines the Conversation already keeps, only from main and the private threads
you opened and never from the conversation he is answering in, a temporary
thread, an observed coding session's conversation, or a child's. What such a
look finds is context for that one reply and is written nowhere.

**How Luke keeps his notebook.** Two things write to Luke's workspace
without your asking, each on your Mac and each bounded. Before a
conversation's working memory is folded (a soft margin ahead of it, or once
its transcript grows past 2 MiB), Luke runs one private housekeeping turn over
a copy of that conversation, allowed only to append to today's dated note
under `memory/`; the copy is thrown away afterwards and nothing from it enters
the conversation, and the same turn runs once when you start main or a
durable private thread fresh, never when you clear or delete the conversation, and
never for a temporary thread, an observed coding session, or a child. Nothing
else writes the notebook on its own: no nightly job reads your conversations
to learn from them, and no model call rewrites `MEMORY.md`, which from here
changes only when you edit it or ask Luke to. An earlier version of Luke
promoted lines into that file behind HTML markers, and wrote a `DREAMS.md`
beside it. Both are left exactly where they are, for you to keep or delete:
`MEMORY.md` is still read as your notebook, markers and all, and nothing
reads `DREAMS.md` at all. Asking Luke to forget removes the notebook line
you name, and the search index follows the file; a line he no longer holds
under that name he says so about rather than claiming it erased. Forgetting does
not delete the conversation itself; Delete conversation is still the separate,
recoverable action above.

**Your account.** Signing in with Google or GitHub gives us your name, email
address, and which of the two you used. We also keep the records that keep you
signed in, and a daily count of how much voice and review you have used.
Luke's own maintainers can see that record — your name, email address, which
sign-in you used, when you joined, when you were last active, and your daily
counts — on an admin page of our site that only an account we have marked as an
administrator can open; nothing you type, say, or run in a session appears on
it. The service also keeps your account's conversation with Luke, as the
record the Conversation tab draws on every Mac you sign in on and the iOS and
Apple Watch apps read. When Luke runs a turn for you on our service, that
turn writes rows to our database: your ask as it was given; Luke's reply, the
summaries of his reasoning, and each tool he called with its input and its
result, the briefing he offered you among them; the words an observation
turn opened with, which for a Conductor session include the messages that
chat gained since he last looked; the turn's model, token counts, and the
ids of OpenAI's responses; and the events about each message — that a briefing was offered,
claimed, spoken, pushed, held, or expired, and each rating you gave — naming
the device that took part. Unlike his workspace files and the facts he
remembers, described below, these rows are not sealed: they are stored as
written, and our own operators can read them. They stand until you clear
the conversation, which marks it deleted so that every device stops drawing
it at its next read and the service removes it thirty days later, or until
you delete your account, which removes it at once.

**Usage data.** We count how Luke's features are used, on the Mac, in the
iOS app, and in the Apple Watch app, and attach your name and email to that
record. The counts are event names and values from a fixed list, and each one
says which of the three apps it came from. A voice session's start is counted
with which of three sources opened it — our voice service on your account,
your own OpenAI key, or the accountless introduction — and never with a key
or a session id. A thumbs up or down you give one of Luke's messages is
counted with the verdict and whether the message was a reply or a briefing,
and never with the message, its id, or a note you left. Nothing you type or
say and nothing from a session can appear in one: no titles, branches, file
paths, prompts, or error text.

**Screen recordings.** Luke records what his own panel draws, and never your
screen, your editor, your terminal, or any other app. A recording shows whatever
the panel showed you, including session titles, branches and error
text, your name and email address, and any screenshot you attached to the
feedback form. The Conversation tab is blocked from recordings, so neither the words in your
conversation with Luke nor the things he remembers about you are included, and
the feedback form's message field is blocked the same way, since a thumbs down
can open it prefilled with those words. Text you type into a field is replaced
with blocks before the recording leaves your Mac, so an API key or a sign-in
code you enter is not in it. While recording is on, Luke also reports what you
clicked, including the text on it; the fixed list above does not cover those
clicks.

Recording starts when Luke opens, before you sign in, so it covers the spoken
introduction on first launch and the signed-out panel. A recording that begins
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

The iOS app records on the same terms: its own screens as screenshots, never
anything else on your device, from the moment it opens, and shows the same
things its screens show — session titles, branches, error text, and
your name and email. A Conductor session's conversation, fetched onto that
session's screen, and your Conversation with Luke on its own screen are each
masked out of recordings the way the desktop's Conversation tab is blocked, so
those messages reach your phone and nothing else. Text you
type into a field is masked, a message you sent stays masked when it is drawn
back as a chat bubble, and a crash is reported on the next launch with its
message and code path. Unlike the Mac
app, taps are not separately reported with their text — only the recording
itself shows what was pressed. Signing in attaches the running recording to
your account, and signing out starts a fresh anonymous one.

The Apple Watch app records nothing and reports no crashes. It counts its use
through the same fixed list as the other two apps, and nothing else leaves it.
The Conversation it shows is read from the same stored messages the phone
reads, under your account, and the watch only reads them: a rating you gave a
message is shown there and cannot be given from the wrist.

**Provider API keys (server-side vault).** While the "Sync provider keys"
switch in Settings > Connections is on — it starts on — the provider API keys
you entered into Luke on this Mac are kept synced to Luke's hosted service,
for your other Luke devices: a key saved while signed in syncs in the same
press, and Luke re-syncs the stored keys when he starts signed in, when you
sign in, and when the switch turns on. Keys Luke merely reads from your
environment are never synced, and an automatic re-sync happens only for the
account these keys were last synced for — a different account signing in on
this Mac syncs nothing until it saves a key or turns the switch on itself. Turning the switch off deletes every synced
copy from our database while the keys on this Mac stay; deleting a key
deletes its synced copy too, and signed out nothing is ever synced. We store a synced key encrypted in our own
database using AES-256-GCM with a server-only secret. The key is never
returned to any caller: there is no endpoint that reads it back, and no code
path that decrypts it for any purpose other than observing your sessions or
carrying the actions you explicitly request through that provider. Every
synced key is deleted alongside your account if you delete that.

**Scheduled observation of your Conductor sessions.** While you hold a synced
Conductor key and have signed in within the last 7 days, our service reads
your Conductor sessions on its own schedule, about once a minute, the same
read-only pass the iOS app used to ask for on demand: your open workspaces,
their chats, each chat's status, the agent kind running it, and the error
line it stopped on. It never reads a chat's messages. On your Mac, a status
change on a Conductor chat wakes Luke's judgment for that chat the way a
change on a local session does; that turn may read the chat's recent messages
under the "read the recent tail" terms above, and the pass itself still reads
none. We keep the latest roster it read, encrypted at rest with the same
server-only secret as your keys, and beside it what changed since the pass
before — a session that appeared or vanished, a status that moved, an error
line that changed — so the Mac app, the phone, and the watch can show your
sessions without asking Conductor again (the Mac app reads this stored roster
from our service on your account about once a minute, and draws its rows from
nothing else), and so Luke can later be woken by a change rather
than by a clock. The roster and its changes are replaced on every pass;
nothing older is kept.
Observation stops, and the stored roster and changes are deleted, when you
delete the synced key, when you have not signed in for 7 days, and alongside
your account if you delete that.

**Devices.** When you sign in on the Mac app, the iOS app, or the Apple Watch
app, that installation registers itself with our service as one device row.
The row holds which platform it is, when it was last seen (refreshed by
every poll and heartbeat: on a timer by the Mac, each time the phone comes
to the foreground, and by the phone's and the watch's Conversation screens
while they are open), an optional push token, and two instants: a presence
instant and a quiet-until instant. The Mac reports both about once a minute
on the same poll it uses to learn what changed: presence set only while your
Mac has seen input in the last two minutes and its screen is unlocked, and
quiet-until as the end of a meeting its calendar hold observes while you
have Luke quiet during meetings. The phone and the watch each report a
presence instant too, on the poll their Conversation screen makes every few
seconds while it is on screen and the app is in the foreground, each holding
for thirty seconds; neither observes a meeting, so neither reports a quiet
instant. Each is an instant and nothing else — not what you typed, not which
app you were in, not the meeting's title, which never reaches the Mac either
— and the service records them and decides nothing from them beyond holding
speech while a quiet instant stands and, for a Mac alone, waiting before it
pushes a briefing, as described next: a phone or watch is present or not, but
only a Mac can be spoken through. The
installation is named by an id the app made up once for itself; it is not a
credential, and neither is a push token, which only our own Apple key can
address. Signing into a different account on the same device moves its one
row to that account rather than leaving a second. The row is deleted when
you sign out on that device, when the phone and the watch part ways with the
account, when Apple reports a push token gone, and alongside your account if
you delete that.

**Briefing notifications.** When Luke decides to tell you something about your
sessions and no device of yours is placed to say it — no Mac of yours
reports itself active, or the active one has not taken the briefing within
two minutes; a phone or watch reporting itself present does not count, since
neither can say it —
our service sends the briefing to the device of yours most recently seen
holding a push token, as a push notification through Apple's push
notification service, addressed to the push token that device registered.
The notification carries Luke's own
words, the briefing exactly as he chose to say it, and one identifier of
our own: the briefing's message id, an opaque identifier unique to that
one message, which is what lets a tap open the Conversation at that briefing
rather than at whichever arrived last. It carries nothing else: no session
title, branch, path, or error line beyond what those words themselves
contain, and the id names none of them and means nothing to anyone but
Luke. It is shown on the lock screen, so it is readable on a locked phone
without unlocking it, and Apple carries it under its own terms on the way.
A briefing is pushed at most once; one a device is already saying is never
pushed; and while any of your devices reports a quiet-until instant,
nothing is pushed until it lifts. Because a device's row moves with its
sign-in, no briefing for the account you left is addressed to that device
afterwards; one already handed to Apple at the moment you switched still
arrives on its lock screen, and nothing we send can stop its display. That
is the one window in which a briefing can reach a device signed in as
someone else, and it holds only a briefing no device of the account had
claimed. The iOS app asks for notification
permission in the system's own dialog at its first launch, before you sign
in; it asks Apple for a push token only where you allowed it, holds that
token on the phone until a sign-in lands, and registers it with our service
only while alerts stay allowed: a
permission you later withdraw in Settings clears the token from your device
row the next time the app comes to the foreground, so no briefing is
settled as pushed to a phone that would show nothing. Tapping the
notification opens the app's Conversation screen at that briefing; on a
phone that has since signed out it opens nothing but the sign-in screen,
and where the briefing is no longer in the thread the Conversation opens at
its end and says so.

**Feedback.** If you use the feedback form, we receive what you typed, the name
and email you signed it with, and any screenshots you attached. A thumbs down
on one of Luke's messages offers to open the form prefilled with that message
and your ask before it, words already on your screen; they are yours to edit or
delete, and like everything else in the form they reach us only when you press
Send.

## Who we send it to

- OpenAI, for voice and for Luke's own judgment. On the Mac, a voice session
  is one continuous conversation: while you hold the talk key everything the
  microphone hears streams to OpenAI, and the moment you let go the
  microphone is closed and nothing does; Luke can still speak into a session
  whose microphone is closed. There is no way to type to Luke; every ask is
  spoken. Each voice session carries the recent Conversation lines and the
  session summary described above as it opens, and every turn sends the
  session fields listed above — on the Mac app, iOS, and Apple Watch alike,
  drawn from the
  same cloud observation your vault keys already
  allow (titles, status, repository, and branch of your cloud sessions, as
  described under Provider API keys above). When you use voice through your
  Luke account, the Mac reaches OpenAI through our own voice service, which
  creates the session on our key, relays the control and transcript events
  between your Mac and OpenAI without reading them, drops the audio OpenAI
  reflects back so your voice never transits our service, keeps no
  conversation, logs only status codes and byte counts, and records the
  billed seconds of each session once, beside which of your registered
  devices opened it (the Mac names its own device row on the handshake, and
  the service accepts that name only for a row your account holds), so a
  briefing that device claims is spoken into that session and no other. With your own OpenAI key the Mac
  reaches OpenAI directly and our service sees nothing of the session. One
  such session opens on its own at every signed-in launch, after the first
  sign-in's arrival beat has played, so Luke can greet you: the greeting is a
  fixed script into which travels only the first word of the name your
  account provider reported, never a session's title or anything else about
  your work, and it waits like an announcement while a meeting or the Announce
  switch holds it. Luke's judgment is a separate call
  to OpenAI's Responses API, made when an agent's hook or his periodic look
  wakes the conversation following that session and when
  you ask him something: it carries that conversation's working memory —
  the bounded transcript excerpts described above, the session fields, the 20
  most recent lines of your conversation, and the things he remembers about
  you — directly to OpenAI on your own key if you entered one, or through our
  own service on our key when you use Luke through your account. Either way
  OpenAI stores the request and its reply under its own retention policy, and
  our service performs one model call per request and stores and logs none of
  the request, the reply, or the encrypted reasoning that travels in it; the
  record the reply joins is kept only on your Mac, under the lifetime above.
  When Luke runs a turn for you on our service, the call to OpenAI is made
  from there, and the record it joins is the conversation our service keeps,
  described under "Your account" above.
  Each call counts against
  your daily review allowance. When Luke runs through your account, the Mac
  app also sends our service the standing instructions it prepared for the
  call — composed on your Mac from Luke's workspace files described above —
  and the names of the tools it means to offer; the service holds the
  tools' own definitions and chooses the model, and a request naming a tool
  it does not know, or carrying instructions longer than its fixed bound, is
  refused rather than trimmed. Every such call also carries a prompt cache
  key: a hash of the conversation's own internal name, sent so a later call
  reuses the earlier calls' billing prefix instead of paying for it again. It
  identifies nothing — no session id or title can be read out of a hash — and
  our service passes it upstream and keeps it no longer than the request.
  The same allowance meters a request to count
  a call's tokens or to fold Luke's working memory, and the folded memory
  OpenAI answers with is kept only on your Mac. Luke's working memory is
  stamped with the version of Luke that wrote it; a newer or older Luke that
  cannot read that stamp leaves the memory untouched and declines to think
  over it until you clear it, rather than rewriting or discarding it. On the Mac app, your conversation and Luke's durable memory are kept on your
  Mac and sent with a call so the conversation carries across calls and across
  launches; on iOS and Apple Watch, a call also carries the list of projects
  your synced keys can create a workspace in, while the conversation itself is
  held in memory until the app quits or you sign out, sent with a call so it
  carries across calls, and never stored on the phone or the watch. A
  development build run from a checkout can write a local trace of this
  traffic when the developer's own shell asks for one; a packaged build has no
  such switch and writes none.
  The one voice session that happens before you sign in is the spoken
  introduction on first launch of the Mac app. It asks for your microphone
  first, through macOS's own dialog at your press, and opens no session if
  you decline. With the microphone granted it opens one GPT Live session
  through our voice service without an account: what travels is the titles
  of the coding agent sessions found on your Mac (at most eight, each cut
  short), our own fixed greeting instruction, and your voice for as long as
  the introduction stands, since the microphone is live from the greeting on
  so you can answer it. It plays once, can act on nothing, and our service
  keeps only a hash of your network address for that day's rate limit, tied
  to nobody, and none of the conversation.
- Coding agent providers you connect (Conductor) and Linear, using the key or
  account access you supply. The synced-key vault holds Conductor keys only.
  Luke reads your sessions or issues, and sends something back
  only when you ask it to, such as a message you wrote or an issue you moved.
  With a synced Conductor key, our service also reads your Conductor sessions
  about once a minute on the schedule described above, under that key.
  If you open a Conductor session's screen in the iOS app, our service also
  reads that session's conversation from Conductor — your own messages and the
  agent's replies, not its tool activity — using the key you synced, and
  passes it to your phone while the screen is open. We store none of it: each
  refresh is a new read, and nothing about the conversation stays on our
  servers after the response is sent. The Mac app reads the same conversation
  through the same service read, under the same synced key, when Luke reads
  a Conductor session's recent tail as described under "What we collect", and
  a message or a workspace Luke sends to a Conductor session at your ask
  travels the same way, admitted by our service against the sessions it last
  showed you.
- Google, if you connect Google Calendar. We request your calendar list and your
  availability. Google returns busy times only, so event titles and attendees
  are never available to Luke.
- PostHog, for usage data and screen recordings, from the Mac, iOS, and
  Apple Watch apps. The counts go through our own service; the recordings,
  desktop clicks, and iOS errors that ride with them go from Luke to PostHog
  directly, and the watch app sends PostHog nothing directly.
- Apple, for briefing notifications. When no device of yours is placed to
  say a briefing, our service hands Luke's words to Apple's push notification
  service, addressed to the push token your device registered, and Apple
  delivers them to the lock screen, where they are readable without
  unlocking. The notification carries those words and the briefing's own
  opaque message id, and nothing else about you or your sessions.
- Sentry, for the anonymous exception, process-session, and native crash reports
  described above.
- GitHub, to check for updates. These requests are unauthenticated and carry
  nothing about you.

We do not sell your information or use it for advertising. If you connect
nothing, Luke sends nothing to any provider, and reading your local sessions
works with no network connection.

## Our website

tryluke.dev counts page views, presses, and sign-in steps using PostHog, and
records the pages themselves. Anything you type is blurred, and so is the text
of whatever you clicked. Your browser contacts PostHog directly, so PostHog sees
your network address, as it does for the app's recordings.

## Storage

Your settings, local provider API keys, and calendar access stay on your
Mac, and so do the conversation, working memory, workspace files, and
remembered facts of a Luke whose judgment runs on your Mac.
Local keys and calendar access are encrypted in the macOS Keychain. Provider
API keys you sync to the hosted service, and the latest roster of your
Conductor sessions with what changed since the pass before, are stored
encrypted in our own database, as described above. When Luke runs a turn for
you on our service, the workspace files and remembered facts that turn reads
and writes are stored sealed in the same database, and the conversation it
writes is stored there unsealed, each as described above. Your account information is held by our own
service, usage counts and recordings by PostHog, and crash reports by Sentry.

## Your choices

- Disconnect any provider, issue tracker, or calendar to stop it being read.
- Delete your OpenAI key to turn voice off.
- Delete any synced provider API key from that provider's row in Settings. Keys
  are also deleted when you delete your account.
- Clear the Conversation tab to have the service mark your account's
  conversation deleted (removed thirty days later, and gone from every Mac on
  the account at its next read) and to remove the stored conversation and
  Luke's working memory of it on this Mac behind a recovery archive. Nothing
  on your Mac discards them on a schedule: a conversation stands until you
  clear it.
- Ask Luke what he remembers, correct a memory, or tell him to forget one.
- Edit or delete any of Luke's workspace files yourself; Luke never overwrites
  your edit, and clearing the Conversation tab does not touch them. Rows of
  them on our service are edited through Luke alone, and go with your
  account.
- Luke may act on his own judgment in a turn you did not open — answering a
  coding agent, keeping his notes, on a hook or a look
  — within the tool policy his configuration sets; the Conversation tab records
  such an action as his own, never as your request.
- What you type or say to Luke goes to his main conversation; the
  conversation an ask is for is fixed at the moment you send it and never
  moved afterwards.
- Luke does not listen through your microphone except while you hold the
  talk key. The press opens the microphone and letting go closes it, so
  macOS's microphone indicator is lit exactly while the key is down; the stop
  key closes it too, and is the one key that also tells Luke to stop talking,
  while letting go of the talk key lets him finish. A voice session Luke
  opens to speak to you opens no
  microphone at all. If Luke's key helper cannot start, the key reports
  presses alone, so one press opens the microphone and the next closes it,
  and the Keyboard shortcuts page says so.
- Delete your account from the Account section in Settings. This erases your
  account, your sign-in records, your usage counts, any provider API keys
  you synced to the hosted service, your device rows, the conversation our
  service kept with its workspace files and remembered facts, and the stored
  roster of your sessions, and asks PostHog to erase your usage data
  and recordings, including the iOS and Apple Watch apps'. It does not reach a recording that was
  never attached to your account, as described above. Luke stops recording for
  the rest of the session, and starts again the next time you open it or sign
  in. Sentry reporting continues after deletion, and prior anonymous crash
  reports cannot be identified as yours and targeted through account deletion.
  Deleting does not affect your Google or GitHub account, and anything stored
  only on your Mac stays there until you remove it.

## Google user data

Luke's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. We use your calendar availability only
to hold Luke's spoken announcements while you are in a meeting. It is not
transferred, sold, or used for advertising, and no human reads it.

## Contact

Email founders@stagereview.app with any questions about this policy.
