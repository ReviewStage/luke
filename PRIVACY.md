# Privacy

Last updated: 7 September 2026

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
ask, he reads the same bounded tail. What he reads is sent to a model as described under
"Who we send it to", and what he keeps of it lives under his working memory's
own lifetime, described below. Nothing else reads message history, file
contents, or command output. If you run
agents inside the Herdr terminal manager, Luke also asks Herdr's own
command-line tool which of those sessions it holds, so their rows can say so;
that read never starts Herdr, reads no terminal output, and sends nothing
anywhere. If you run Claude Code sessions in the Claude desktop app's Code tab,
Luke also reads that app's own list of the sessions it holds — each one's
title, whether you archived it, and the id the app opens it by — so their rows
can say which app holds them and open there; that read opens no transcript and
sends nothing anywhere. It stays on your Mac unless a feature below sends it.

**Your conversation with Luke.** Luke keeps the conversations you have with
him — what you typed or said, what he spoke or announced, the actions he took
at your request, and the asks he is still working on — in a database on your
Mac, so they are still there the next time you open him. The History tab
shows the main conversation, the one the talk key and every observation
reach. The tab draws a conversation's 200 most recent entries and nothing
older than 14 days, each in full; that is what is shown, not what is kept.
Every entry stays in the database until you clear the conversation or the
housekeeping described below removes it. Beside the History, Luke keeps a transcript
of each conversation's turns in the same database: every input the model was
shown and every point at which his working context was folded. The transcript
is a record, not a limit: folding the context changes what the model sees
next and erases nothing here. The 20 most recent History lines, each cut to
400 characters, ride into a conversation as context, beside the working
memory. A thread you open as temporary is held in memory alone and is gone
when Luke next opens; nothing said in it is remembered automatically. Nothing
about a conversation is written on our servers, and a fixture or evidence run
keeps no conversation at all.

**Luke's workspace.** Luke keeps a small set of Markdown files of his own on
your Mac, under his application data (`agents/main/workspace`): his operating
instructions, his personality, his identity, stable facts about you, curated
notes, first-run setup notes, and the instructions for his scheduled review,
plus dated notes under `memory/`. He seeds any file that is missing and never
overwrites one that exists, so you may edit them freely. The files are read
into the standing instructions of every call he makes (each cut to 20,000
characters and the set to 60,000), so their contents travel to OpenAI with his
working memory as described below; dated notes travel only when he reads one
or when a conversation starts fresh. Luke may edit these files himself through
his own tools, in any of his turns, and nothing else on your machine: a
coding agent's transcript or session state is never written, and a write whose
arguments are malformed is refused rather than filled in.

**Luke's working memory.** For each conversation Luke keeps a working memory
of his own turns in the same database, in its own tables: the model's record
of what he read, said, and did — the transcript excerpts described above, the
position he last read each transcript to, a record of each ask you made and
how it ended, and a receipt for each action he took at your ask. When that
record grows long, Luke folds its older part: he asks OpenAI to compact it,
which answers an opaque, encrypted compaction item he stores in place of the
older part, or, on a connection that cannot compact, he asks the model for a
written summary and keeps that instead. Either is still derived from your
sessions and your conversation and lives under the same rule as the rest. The
folding is Luke's own decision, made when the record nears the model's
window or the size a request may be; OpenAI is not asked to compact on its
own. The whole record is one generation, and a generation does not reset
on its own, on the terms OpenClaw's sessions keep: it stands, the encrypted
compaction included, until you clear the conversation, and an old one is
loaded whole however long ago it began. A
generation holds at most 200 asks and stays under 8 MiB: the oldest finished
asks go first once their endings are in the History, and when nothing can go
Luke declines a new ask rather than growing the record.

The History tab's one control, **Clear**, removes the conversation's
History, transcript, and working memory from the database, and writes them
first, in the same step, into a compressed recovery archive kept on your Mac
under Luke's own data (a `.jsonl.deleted.<time>.zst` file, and until it is
written to disk, a copy inside the database); the deletion is reported
complete only once that file is written and verified, and a copy not yet
written is written at the next launch. Nothing in the app reads an archive
back yet; it stands on your Mac for you alone. Clearing never touches the
separate things Luke remembers about you, described next, and never touches
your agents' own files.

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

**Things Luke remembers about you.** During a conversation you start, Luke may
silently save a concise preference, personal fact, goal, or recurring constraint
that looks useful later. He skips temporary details and uncertain guesses, never
saves credentials, and saves sensitive facts only when you explicitly ask. At
most 32 are stored on your Mac, in the same database, and they do not expire.
The iOS app keeps no such memory and does not read the Mac's. You can ask Luke
what he remembers, correct something, or tell him to forget it.
They travel with the rest of Luke's working memory when he thinks, so he can
personalize replies: directly to OpenAI on your own key if you entered one, or
through our own service on our key when you use Luke through your account, on
the same terms as the rest of that call — one model call per request, and
nothing of it stored or logged by our service. They are never sent to a
coding-agent provider or a tracker, and they are never used to decide anything
on your behalf.

**Your account.** Signing in with Google or GitHub gives us your name, email
address, and which of the two you used. We also keep the records that keep you
signed in, and a daily count of how much voice and review you have used.

**Usage data.** We count how Luke's features are used, on the Mac, in the
iOS app, and in the Apple Watch app, and attach your name and email to that
record. The counts are event names and values from a fixed list, and each one
says which of the three apps it came from. Nothing you type or say and nothing
from a session can appear in one: no titles, branches, file paths, prompts, or
error text.

**Screen recordings.** Luke records what his own panel draws, and never your
screen, your editor, your terminal, or any other app. A recording shows whatever
the panel showed you, including session titles, branches and error
text, your name and email address, and any screenshot you attached to the
feedback form. The History tab is blocked from recordings, so neither the words in your
conversation with Luke nor the things he remembers about you are included. Text you type into a field is replaced
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
session's screen, is masked out of recordings the way the desktop's History
tab is blocked, so those messages reach your phone and nothing else. Text you
type into a field is masked, a message you sent stays masked when it is drawn
back as a chat bubble, and a crash is reported on the next launch with its
message and code path. Unlike the Mac
app, taps are not separately reported with their text — only the recording
itself shows what was pressed. Signing in attaches the running recording to
your account, and signing out starts a fresh anonymous one.

The Apple Watch app records nothing and reports no crashes. It counts its use
through the same fixed list as the other two apps, and nothing else leaves it.

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
path that decrypts it for any purpose other than the observation or acts you
explicitly request through that provider. The server-side use of these keys
ships as a separate feature; this describes only the storage. Every synced key
is deleted alongside your account if you delete that.

**Phone notifications.** When you sign into the iOS app, it registers the push
token Apple issued to that installation with our service, so we can address
notifications to it. The token names the installation and nothing else, and
it is not a credential. We store it with your account and delete it when you
sign out on that phone, when Apple reports it gone, and alongside your account
if you delete that. While a phone is registered and you have synced a
provider API key, our service checks your cloud sessions about once a minute
using that key, the same read it makes when you open the app, and sends a
notification when a session starts waiting on you or stops on an error. To
tell a change from what it already saw, the service keeps one record per
account of which sessions it last saw, their status, and when it last
notified you about each, and nothing else about them; the record is deleted
when no phone is registered, when no key is synced, and with your account.
The notification carries the session's title, its workspace, the one line
its provider wrote about what it is waiting on or why it stopped, and its id
so a tap opens it. Unlike the Mac app's announcements, no model decides or
words a notification: it is a fixed rule over the status your provider
reported.

**Feedback.** If you use the feedback form, we receive what you typed, the name
and email you signed it with, and any screenshots you attached.

## Who we send it to

- Apple, for iPhone notifications. Each one carries the session fields named
  under Phone notifications above and travels through Apple's push service to
  the phones registered to your account. Apple's handling of it is described
  in Apple's own privacy policy.
- OpenAI, for voice and for Luke's own judgment. A spoken turn sends its
  audio, a typed turn sends your words, and both send the session fields
  listed above — on the Mac app, read locally from your machine; on iOS and
  Apple Watch, drawn from the same cloud observation your vault keys already
  allow (titles, status, repository, and branch of your cloud sessions, as
  described under Provider API keys above). Luke's judgment is a separate call
  to OpenAI's Responses API, made when an agent's hook or his periodic look
  wakes him and when you ask him something: it carries his working memory —
  the bounded transcript excerpts described above, the session fields, the 20
  most recent lines of your conversation, and the things he remembers about
  you — directly to OpenAI on your own key if you entered one, or through our
  own service on our key when you use Luke through your account. Either way
  the request asks OpenAI not to store it, and our service performs one model
  call per request and stores and logs none of the request, the reply, or the
  encrypted compaction that travels in it; the compaction OpenAI hands back is
  kept only on your Mac, under the lifetime above. Each call counts against
  your daily review allowance. When Luke runs through your account, the Mac
  app also sends our service the standing instructions it prepared for the
  call — composed on your Mac from Luke's workspace files described above —
  and the names of the tools it means to offer; the service holds the
  tools' own definitions and chooses the model, and a request naming a tool
  it does not know, or carrying instructions longer than its fixed bound, is
  refused rather than trimmed. The same allowance meters a request to count
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
  The one voice call that happens before you sign in is the spoken
  introduction on first launch of the Mac app: it sends its own fixed script,
  the titles of the coding agent sessions found on your Mac, and anything you
  say during its practice moment. It plays once, can act on nothing, and our
  service issues its credential without an account — keeping only a hash of
  your network address for that day's rate limit, tied to nobody.
- Coding agent providers you connect (Conductor) and Linear, using the key or
  account access you supply. For Codex cloud tasks, that access is the sign-in
  you already gave the provider's own command-line tool, which Luke runs and
  never reads. The synced-key vault holds Conductor keys only. Luke reads your sessions or issues, and sends something back
  only when you ask it to, such as a message you wrote or an issue you moved.
  If you open a Conductor session's screen in the iOS app, our service also
  reads that session's conversation from Conductor — your own messages and the
  agent's replies, not its tool activity — using the key you synced, and
  passes it to your phone while the screen is open. We store none of it: each
  refresh is a new read, and nothing about the conversation stays on our
  servers after the response is sent.
- Google, if you connect Google Calendar. We request your calendar list and your
  availability. Google returns busy times only, so event titles and attendees
  are never available to Luke.
- PostHog, for usage data and screen recordings, from the Mac, iOS, and
  Apple Watch apps. The counts go through our own service; the recordings,
  desktop clicks, and iOS errors that ride with them go from Luke to PostHog
  directly, and the watch app sends PostHog nothing directly.
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

Your settings, your conversation with Luke, his working memory, his workspace
files, the things he remembers about you, local provider API keys, and
calendar access stay on your Mac.
Local keys and calendar access are encrypted in the macOS Keychain. Provider
API keys you sync to the hosted service are stored encrypted in our own
database, as described above, and so are your phones' push tokens and the
record of which cloud sessions our service last saw for them. Your account
information is held by our own service, usage counts and recordings by
PostHog, and crash reports by Sentry.

## Your choices

- Disconnect any provider, issue tracker, or calendar to stop it being read.
- Delete your OpenAI key to turn voice off.
- Delete any synced provider API key from that provider's row in Settings. Keys
  are also deleted when you delete your account.
- Sign out of the iOS app to stop notifications to that phone; its token is
  deleted at once and the service's record of your sessions on the next
  check if no phone remains.
- Clear the History tab to remove the stored conversation and Luke's working
  memory of it behind a recovery archive on your Mac. Nothing discards them
  on a schedule: a conversation stands until you clear it.
- Ask Luke what he remembers, correct a memory, or tell him to forget one.
- Edit or delete any of Luke's workspace files yourself; Luke never overwrites
  your edit, and clearing the History tab does not touch them.
- Luke may act on his own judgment in a turn you did not open — answering a
  coding agent, keeping his notes — within the tool policy his configuration
  sets; the History tab records such an act as his own, never as your request.
- Luke does not use your microphone until you start a turn.
- Delete your account from the Account section in Settings. This erases your
  account, your sign-in records, your usage counts, and any provider API keys
  you synced to the hosted service, and asks PostHog to erase your usage data
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
