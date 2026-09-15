# Privacy

Last updated: 15 September 2026

Luke is a macOS app that watches your coding agent sessions, with companion
iOS and Apple Watch apps for the cloud sessions your account can see. This
policy explains what we collect, who we send it to, and how to turn it off.

## What we collect

**On your Mac.** Luke reads no session file on your Mac, and nothing on it
reads message history, file contents, or command output. The sessions the
panel lists are the ones our service last observed under the Conductor key
you synced, as described under "Scheduled observation of your Conductor
sessions" below: the Mac app reads that stored roster from our service about
once a minute, draws each row — the session's title, status, repository,
branch, the agent kind running it, and the error line it stopped on — from
nothing else, and keeps none of those fields in a file of its own. Luke's
look at those sessions runs on our service too, never here: a change our
service observes on a Conductor chat wakes a turn there, in a conversation of
Luke's own that follows that one session, and that turn may read the messages
the chat gained since he last looked — your own messages and the agent's
replies, not its tool activity — under the terms below; what our service
keeps of such a turn is described under "Your account". No part of his
judgment runs on this Mac, so no transcript, working memory, or inbox of his
is held here, in memory or on disk.

**Your conversation with Luke.** Nothing on your Mac holds your conversation
with Luke: no part of his judgment runs here, so no record of what you said,
what he spoke or announced, or what he did at your ask is kept on this
machine, in memory or on disk. The Conversation tab draws the one record there
is: the conversation Luke's own service keeps for your account, read by every
Mac you sign in on, so two Macs on one account show the same thread. A signed-in Mac asks the service every few seconds what has
changed and reads only what did, and it draws the 200 most recent turns; that
is what is shown, not what is kept. A thumbs up or down you give one of Luke's
messages there is written to the same service as a rating event beside that
message, naming the verdict and the Mac it came from, so it shows on every
device signed in to your account, including the next time you open Luke; a
second verdict is a second event, pressing the filled thumb again takes your
verdict back as a third event that says so and leaves the message unrated,
and the newest is what every device shows. Taking a verdict back does not
erase it: the record keeps every verdict you gave and the fact that you took
it back, and only the newest is shown.
Pressing thumbs down also offers the feedback composer, prefilled with that
message and your ask before it, and nothing of it leaves the Mac unless you
press Send. What the service keeps of it is described under "Your account"
below.
When a voice session opens, this Mac hands it a summary of the coding agent
sessions on your screen (their titles, status, and branch, as the rows draw
them), so the voice can follow what is on your desk as it stood when the
session opened; no line of your conversation is handed to the session, from
here or from our service, and what Luke knows of it when he answers a spoken
ask he reads on our service, from the record described under "Your account"
below. What our servers keep
of a conversation is the record described under "Your account" below; a
fixture or evidence run keeps no conversation at all.

**Luke's workspace.** Luke's workspace is a small set of Markdown files — his
operating instructions, his identity, stable facts about you, curated notes,
first-run setup notes, and dated notes — kept as rows in our database, one row
per file per account: seeded with the same defaults the first time a turn runs
for you, composed into the standing instructions every turn runs under (each
cut to 20,000 characters and the set to 60,000), and edited only through
Luke's own workspace tools there, in his turns. The file's name is stored in
the clear and its contents are sealed under a key only our service holds,
each row bound to your account so it cannot be opened under another. Those
rows are untouched by clearing the conversation and are removed when you
delete your account. Earlier versions of Luke kept the same files on your Mac,
under his application data (`agents/main/workspace`), and read them into the
calls they made from here; this version makes no such call, seeds nothing
there, and reads nothing from it. Files an earlier version left are yours to
keep or delete, and nothing on your Mac reads or writes them.

**Luke's working memory.** Luke's judgment keeps a working memory of its own
turns — the model's record of what he read, said, and did, folded into a
written summary of his own when it grows long — and it is kept where his
judgment runs, on our service, under the terms described under "Your account"
below. Nothing of it is held on your Mac, in memory or on disk: a launch here
begins with none and a quit lets nothing go, because there was nothing here.

The Conversation tab's one control, **Clear**, asks Luke's service to clear
your account's conversation: nothing is erased at once — the conversation is
marked deleted, a new empty one is opened in its place, every Mac on the
account stops showing it on its next read, and the service removes the
marked conversation thirty days later. A Clear the service did not take
leaves the thread standing and says so. Nothing on your Mac holds a copy to
forget. Clearing never touches the separate things Luke remembers about you,
described next, and never touches your agents' own files.

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
(decrypted where it runs, under the same Keychain entry), your account's
session, and the observation of your sessions and calendars, while the part
that draws listens, speaks, holds the keys, and asks the runtime for
everything else. Nothing
about you crosses that boundary that the panel did not already draw; no
stored key, token, or account secret travels in any answer or event, and the
voice window is handed no credential at all — the runtime opens each voice
session itself and hands the window only the connection answer it needs to
hear and be heard. Quitting Luke cancels
what was running and writes down what did not finish rather than finishing it
on paper. The two things the app still does on this machine at the runtime's
ask are opening an address you asked to open and running the Calendar helper
behind macOS's own consent dialog.

**Things Luke remembers about you.** When Luke runs a turn for you on our
service, he may silently save a concise preference, personal fact, goal, or
recurring constraint that looks useful later. He skips temporary details and
uncertain guesses, never saves credentials, and saves sensitive facts only when
you explicitly ask. Each is a row of its own in our database, its words sealed
the same way as his workspace files there and bound to your account; a changed
fact replaces the one it corrects, clearing the conversation does not touch
them, and they are removed when you delete your account. Nothing on your Mac
saves or reads one: an earlier version kept them as lines of `USER.md` in the
workspace it held here, and a `USER.md` that version left is neither read nor
written by this one. The iOS app keeps no such memory of its own. You can ask Luke what
he remembers, correct something, or tell him to forget it. They travel with the
rest of Luke's working memory when he thinks on our service, so he can
personalize replies, on the same terms as the rest of that call — one model
call per request, and nothing of it stored or logged by our service beyond the
rows themselves. They are never sent to a coding-agent provider or a tracker,
and they are never used to decide anything on your behalf.

**Luke's notebook index.** Luke keeps no search index over his workspace
files any more. An earlier version kept one in the database above — `MEMORY.md`,
`USER.md`, and the notes under `memory/`, cut into passages with a numeric
embedding of each made by OpenAI's embeddings model — and nothing on your Mac
makes an embedding now. Luke's own conversations were never embedded or
indexed.

**How Luke keeps his notebook.** Nothing on your Mac writes Luke's notebook:
no housekeeping turn runs here, no nightly job reads your conversations to
learn from them, and no model call on this machine rewrites `MEMORY.md`. The
notebook Luke keeps is the workspace rows on our service, described above,
written only through his own workspace tools in his turns there. An earlier
version of Luke wrote a dated note under `memory/` and promoted lines into
`MEMORY.md` behind HTML markers on your Mac, and wrote a `DREAMS.md` beside
it; each is left exactly where it is, for you to keep or delete, and nothing
reads any of them. Asking Luke to forget removes the remembered fact you name
from our service; a fact he no longer holds under that name he says so about
rather than claiming it erased. Forgetting does not delete the conversation
itself; Clear is still the separate action above.

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
claimed, spoken, pushed, held, or expired, and each rating you gave or took
back — naming the device that took part. When you speak with Luke through your account
and he answers you himself, without running a turn, that exchange is kept
too, the same way: what you said as your line and what he said as his,
each written once it has settled, so the Conversation shows a spoken
exchange he answered himself exactly as it shows one he thought about.
Unlike his workspace files and the facts he
remembers, described below, these rows are not sealed: they are stored as
written, and our own operators can read them. They stand until you clear
the conversation, which marks it deleted so that every device stops drawing
it at its next read and the service removes it thirty days later, or until
you delete your account, which removes it at once.

**Usage data.** We count how Luke's features are used, on the Mac, in the
iOS app, and in the Apple Watch app, and attach your name and email to that
record. The counts are event names and values from a fixed list, and each one
says which of the three apps it came from. A voice session's start is counted
with which of two sources opened it — our voice service on your account, or
the accountless introduction — and never with a session id. A count made
while no account is signed in on the Mac — a
launch, or the introduction where it plays before you sign in — is not sent
then: it waits in a file in Luke's own data folder, for at most seven days
and at most two hundred counts, and is sent under the account that next
signs in, even when that is in a later launch. A Mac that never signs in
sends none of them. A thumbs up or down you give one of Luke's messages, or
take back, is counted with the verdict or the fact that you took it back and
whether the message was a reply or a briefing, and never with the message,
its id, or a note you left. Nothing you type or
say and nothing from a session can appear in one: no titles, branches, file
paths, prompts, or error text.

**Screen recordings.** Luke records what his own panel draws, and never your
screen, your editor, your terminal, or any other app. A recording shows whatever
the panel showed you, including session titles, branches and error
text, your name and email address, and any screenshot you attached to the
feedback form. The Conversation tab is blocked from recordings, so neither the words in your
conversation with Luke nor the things he remembers about you are included, and
the feedback form's message field is blocked the same way, since a thumbs down
can open it prefilled with those words. The caption strip under Luke's shape is
not blocked: with Captions on, it draws his spoken words and yours as you speak
to him, so a recording made while you talk to Luke includes what you said. Text
you type into a field is replaced
with blocks before the recording leaves your Mac, so an API key or a sign-in
code you enter is not in it. While recording is on, Luke also reports what you
clicked, including the text on it; the fixed list above does not cover those
clicks.

Recording starts when Luke opens, before you sign in, so it covers the
signed-out panel, the sign-in, and the spoken introduction that follows your
first sign-in. A recording that begins
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
those messages reach your phone and nothing else. Text you type into a field
is masked, a message you sent stays masked when it is drawn back as a chat
bubble, and taps are not separately reported with their text — only the
recording itself shows what was pressed. Separately, in ordinary runs the iOS
app sends Sentry anonymous exception and process-session reports and native
crash reports on the next launch, with the same posture as the Mac app: no
Luke account or other identity, no PII collection, no tracing, no Sentry
Replay, no screenshots, no profiling, and no manual reports of handled
errors. Signing in attaches the running recording to your account, and signing
out starts a fresh anonymous one.

The Apple Watch app records nothing. It counts its use through the same fixed
list as the other two apps, and in ordinary runs it also sends Sentry's
anonymous process-session status. Sentry's watchOS support does not capture
native crashes there, so no watch crash report is filed.
The Conversation it shows is read from the same stored messages the phone
reads, under your account, and the watch only reads them: a rating you gave a
message is shown there and cannot be given from the wrist.

**Provider API keys (server-side vault).** The Conductor key you enter into
Luke is held by our service, not by your Mac. Saving it sends it, in the same
press, to our vault under your signed-in account, and nothing of it is written
to this Mac: no settings file, no Keychain entry, no cache. Luke asks for it
right after your first sign-in, before showing any sessions; if you skip, the
list stays empty and says so, and the row in Settings > Connections is the way
to connect later. Its row reads
"Held by Luke's service" from the vault's own list of which providers hold a
key, never from anything stored here, and you have to be signed in to save
one. Deleting it from its row deletes it from the vault. A key an earlier
version of Luke kept encrypted on this Mac is handed to the vault once, the
next time the account it was last synced for signs in, and deleted from the
Mac when the vault confirms it; a key another account left here is sent
nowhere, and a key Luke merely reads from your shell's environment is never
sent and no longer connects anything. We store the key encrypted in our own database using
AES-256-GCM with a server-only secret. It is never returned to any caller:
there is no endpoint that reads it back, and no code path that decrypts it
for any purpose other than observing your sessions or carrying the actions
you explicitly request through that provider. Every key is deleted alongside
your account if you delete that. Voice holds no key of yours at all: it runs
through our service on your account, and a key of your own that an earlier
version of Luke stored for it is removed from your Mac the next time Luke
opens, without being read.

**Scheduled observation of your Conductor sessions.** While you hold a synced
Conductor key and have signed in within the last 7 days, our service reads
your Conductor sessions on its own schedule, about once a minute, the same
read-only pass the iOS app used to ask for on demand: your open workspaces,
their chats, each chat's status, the agent kind running it, and the error
line it stopped on. It never reads a chat's messages. A status change the
pass finds on a Conductor chat wakes Luke's judgment for that chat, on our
service; that turn may read what the chat's conversation gained since he
last looked — your own messages and the agent's replies, not its tool
activity, cut from the front to 20,000 characters — under the same synced
key, and the pass itself still reads none. We keep the latest roster it read, encrypted at rest with the same
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
on the same poll it uses to learn what changed, and once more the moment you
flip the announcements switch or the spoken introduction finishes: presence
set only while your Mac has seen input in the last two minutes and its screen
is unlocked, and quiet-until as the later of two ends — the end of a meeting
its calendar hold observes while you have Luke quiet during meetings, and,
while announcements are switched off or the spoken introduction is still
owed, an instant one to two hours ahead that each poll moves forward again,
so that hold lifts on its own if the Mac stops polling. The phone and the
watch each report a presence instant too, on the poll their Conversation screen makes every few
seconds while it is on screen and the app is in the foreground, each holding
for thirty seconds; neither observes a meeting, so neither reports a quiet
instant. Each is an instant and nothing else — not what you typed, not which
app you were in, not the meeting's title, which never reaches the Mac either
— and the service records them and decides nothing from them beyond holding
speech while a quiet instant stands and, for a Mac alone, waiting before it
pushes a briefing, as described next: a phone or watch that is merely present
is pushed to rather than waited on, since neither opens a call of its own for
a briefing — though a call you have already placed on either says the
briefings that arrive while it stands. The
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
neither opens a call of its own to say it —
our service sends the briefing to the device of yours most recently seen
holding a push token, as a push notification through Apple's push
notification service, addressed to the push token that device registered.
A briefing that arrives while a call of yours is standing on a phone or a
watch is said in that call, under the same one-claim rule the Mac's call
follows, and is never pushed; a phone or watch that is merely present, with
no call standing, is pushed to at once rather than waited on.
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

- OpenAI, for voice and for Luke's own judgment. A voice session is one
  continuous conversation, on the Mac, the iPhone, and the Apple Watch alike:
  while you hold the talk key on your Mac, or the talk control on your phone
  or your watch, everything the microphone hears streams to OpenAI, and the
  moment you let go nothing does. The microphone is closed on the Mac and the
  watch, and muted on the phone, where a quick tap on the control instead
  leaves it open until the next tap; Luke can still
  speak into a session whose microphone is closed. There is no way to type to
  Luke on any device; every ask is spoken. A Mac's session opens with a
  bounded summary of your coding agents — at most ten of them,
  each as its title, which provider it belongs to, whether it is working,
  waiting on you, finished, or failed, the tool it is holding for your
  permission, and roughly how long since its provider last wrote about it,
  and nothing else about it: no branch, repository, error line, model,
  address, or conversation. That summary is what the session opens with; a
  change to your desk while the session is open is not sent to the voice, and
  what Luke says about it he reads for himself when you ask. A phone's or a
  watch's session opens with nothing at all: neither sends a summary of your
  sessions, a list of your projects, a line of your conversation, or any
  instruction of its own, and neither holds a conversation of its own, in
  memory or on disk. On every device, what you say and what Luke says in a
  call is written to your account's Conversation by our service, as
  described under "Your account" above, and kept nowhere on the device. Every turn sends the
  session fields listed above — on the Mac app, iOS, and Apple Watch alike,
  drawn from the
  same cloud observation your vault keys already
  allow (titles, status, repository, and branch of your cloud sessions, as
  described under Provider API keys above). When you use voice through your
  Luke account, your Mac or your phone reaches OpenAI through our own voice
  service, which
  creates the session on our key, relays the control and transcript events
  between your device and OpenAI, reads them on our side to keep the record and
  to hand each spoken ask to Luke's judgment (no device of yours answers a
  spoken ask itself), drops the audio OpenAI
  reflects back so on a Mac's or a phone's call neither your voice nor Luke's
  transits our service, keeps of the
  exchange only the lines described under "Your account" above, logs only
  status codes and byte counts, and records the
  billed seconds of each session once, beside which of your registered
  devices opened it (each device names its own device row on the handshake,
  and the service accepts that name only for a row your account holds), so a
  briefing that device claims is spoken into that session and no other. The
  watch has no WebRTC, so its call takes the one route on which the audio
  does transit our service, in both directions: the watch streams what its
  microphone hears to our service, our service holds the session's own
  connection to OpenAI on our key and passes your voice up and Luke's down,
  each as PCM16 audio at 16 kHz, and the same exchange, record, and device
  row stand behind the call as behind a Mac's or a phone's. A watch call ends
  when the service's function does, after at most 800 seconds, and the next
  press opens a new one; on the way through, our service keeps none of the
  audio.
  Every voice session is opened this way, through our service on your
  account: nothing on the Mac, the phone, or the watch holds or is handed a
  credential for OpenAI, and no device of yours reaches OpenAI on a key of
  your own. One such
  session opens on its own at every signed-in launch, after the first
  sign-in's arrival beat has played, so Luke can greet you: your Mac decides
  the greeting is owed and asks our service to speak it, and the service
  speaks a fixed script into which travels only the first word of the name
  your account provider reported, never a session's title or anything else
  about your work; the two onboarding lines (that you are all set, and the
  ask to connect a calendar) reach the service the same way, carrying at most
  the title of one working session and the name of your talk key, and each
  waits like an announcement while a meeting or the Announce switch holds it.
  A session also opens on its own when a briefing Luke has decided is on
  offer to your account and this Mac is present (input within the last two
  minutes, screen unlocked) with nothing holding him quiet, so the briefing
  is said here rather than pushed to your phone: that opening is decided from
  the offer's own status row and your Mac's presence, never by a model, it
  opens at most one session a minute and none while one already stands, a
  briefing another device claims first is left to it, and the phone's
  two-minute grace is unchanged.
  Luke's judgment is a separate call to OpenAI's Responses API, made from our
  service when a scheduled pass wakes the conversation following that session
  and when you ask him something: it carries that conversation's working
  memory — the bounded transcript excerpts described above, the session
  fields, the recent lines of your conversation, and the things he remembers
  about you — on our key. No such call is made from your Mac, your phone, or
  your watch: none of the three apps composes instructions, offers tools, or
  holds a record the reply joins; the record is the conversation our service
  keeps, described under "Your account" above. OpenAI stores the request and its reply under its own
  retention policy, and our service performs one model call per request and
  stores and logs none of the request, the reply, or the encrypted reasoning
  that travels in it. Each call counts against your daily review allowance.
  Every such call also carries a prompt cache key: a hash of the
  conversation's own internal name, sent so a later call reuses the earlier
  calls' billing prefix instead of paying for it again. It identifies nothing
  — no session id or title can be read out of a hash — and our service passes
  it upstream and keeps it no longer than the request. The same allowance
  meters a request to count a call's tokens or to fold Luke's working memory.
  A
  development build run from a checkout can write a local trace of this
  traffic when the developer's own shell asks for one; a packaged build has no
  such switch and writes none.
  The spoken introduction plays once, right after your first sign-in on the
  Mac app; if you never sign in, it never plays. It is a scripted greeting,
  not a conversation. It asks for your microphone first, through macOS's own
  dialog at your press, so the talk key can work afterwards; the greeting
  itself never listens, plays whether you allow the microphone or not, and
  opens its one GPT Live session through our voice service with no
  microphone attached and never unmuted, so nothing you say during it leaves
  your Mac. Luke greets you by name: the first word of the name on your
  account is sent to our voice service, as data for the greeting alone, and
  that is the one thing about you that travels with it. The session is
  opened without your account token, and our service keeps only a hash of
  your network address for that day's rate limit and none of the greeting.
  Nothing about your coding agent sessions travels: the offer keeps a seat
  for their titles (at most eight, each cut short) and the app sends it
  empty, and the introduction draws no sessions on screen, real or pretend.
  It can act on nothing.
- Coding agent providers you connect (Conductor), using the key or
  account access you supply. The vault holds Conductor keys only.
  Luke reads your sessions, and sends something back
  only when you ask it to, such as a message you wrote.
  With a Conductor key in the vault, our service also reads your Conductor sessions
  about once a minute on the schedule described above, under that key.
  If you open a Conductor session's screen in the iOS app, our service also
  reads that session's conversation from Conductor — your own messages and the
  agent's replies, not its tool activity — using the key you synced, and
  passes it to your phone while the screen is open. We store none of it: each
  refresh is a new read, and nothing about the conversation stays on our
  servers after the response is sent. The observation turn our service runs
  when a chat's status changes reads what that chat gained the same way,
  under the same synced key, as described under "Scheduled observation of
  your Conductor sessions"; nothing on your Mac reads a Conductor chat's
  messages. A message or a workspace Luke sends to a Conductor session at
  your ask travels the same way, admitted by our service against the
  sessions it last showed you.
- Google, if you connect Google Calendar. We request your calendar list and your
  availability. Google returns busy times only, so event titles and attendees
  are never available to Luke.
- PostHog, for usage data and screen recordings, from the Mac, iOS, and
  Apple Watch apps. The counts go through our own service; the recordings and
  desktop clicks go from Luke to PostHog directly, and the watch app sends
  PostHog nothing directly.
- Apple, for briefing notifications. When no device of yours is placed to
  say a briefing, our service hands Luke's words to Apple's push notification
  service, addressed to the push token your device registered, and Apple
  delivers them to the lock screen, where they are readable without
  unlocking. The notification carries those words and the briefing's own
  opaque message id, and nothing else about you or your sessions.
- Sentry, for the anonymous exception, process-session, and native crash reports
  described above; on watchOS this is limited to process-session status because
  the SDK does not capture native crashes there.
- GitHub, to check for updates. These requests are unauthenticated and carry
  nothing about you.

We do not sell your information or use it for advertising. If you connect
nothing, Luke sends nothing to any provider.

## Our website

tryluke.dev counts page views, presses, and sign-in steps using PostHog, and
records the pages themselves. Anything you type is blurred, and so is the text
of whatever you clicked. Your browser contacts PostHog directly, so PostHog sees
your network address, as it does for the app's recordings.

## Storage

Your settings, local provider API keys, and calendar access stay on your
Mac. Nothing of your conversation with Luke, his working memory, or his
workspace is kept on your Mac.
Your calendar access is encrypted in the macOS Keychain. Your
Conductor key, and the latest roster of your
Conductor sessions with what changed since the pass before, are stored
encrypted in our own database and nowhere on your Mac, as described above. When Luke runs a turn for
you on our service, the workspace files and remembered facts that turn reads
and writes are stored sealed in the same database, and the conversation it
writes is stored there unsealed, each as described above. Your account information is held by our own
service, usage counts and recordings by PostHog, and crash reports by Sentry.

## Your choices

- Disconnect any provider or calendar to stop it being read.
- Sign out of your Luke account to turn voice off.
- Delete your Conductor key from its row in Settings, which removes it from
  our vault. Keys are also deleted when you delete your account.
- Clear the Conversation tab to have the service mark your account's
  conversation deleted (removed thirty days later, and gone from every Mac on
  the account at its next read). Nothing on your Mac holds a copy to discard.
- Ask Luke what he remembers, correct a memory, or tell him to forget one.
- Delete any workspace file an earlier version of Luke left on your Mac;
  nothing reads it now. Luke's workspace rows on our service are edited
  through Luke alone, are untouched by clearing the Conversation tab, and go
  with your
  account.
- Luke may act on his own judgment in a turn you did not open — answering a
  coding agent, keeping his notes, on a look
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
  and the Keyboard shortcuts page says so. On the phone, the microphone is
  unmuted only while you hold the talk control, or, after a quick tap, until
  the next tap; on the watch, it is open only while you hold the talk
  control, and what the watch sends between presses is silence of its own
  making, not what it hears.
- Delete your account from the Account section in Settings. This erases your
  account, your sign-in records, your usage counts, any provider API keys
  you synced to the hosted service, your device rows, the conversation our
  service kept with its workspace files and remembered facts, and the stored
  roster of your sessions, and asks PostHog to erase your usage data
  and recordings, including the iOS app's. The Apple Watch app sends no
  direct PostHog data, and its counted events are erased with your Luke
  account. It does not reach a recording that was never attached to your
  account, as described above. Luke stops recording for the rest of the
  session, and starts again the next time you open it or sign in. Sentry
  reporting continues after deletion, and prior anonymous crash reports cannot
  be identified as yours and targeted through account deletion.
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
