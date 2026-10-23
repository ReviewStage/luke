# Privacy

Last updated: 23 October 2026

Luke is a macOS app for planning a feature by voice. This policy explains
what we collect, who we send it to, and how to turn it off.

## In short

- **What Luke stores.** On your Mac, only its window layout and the messages
  you have not sent yet. On our service: your account, your tasks and their
  plans, your agents' transcripts, and your conversation. Coding agents work
  in sandboxes on our service, not on your Mac. See [What we
  collect](#what-we-collect) and [Storage](#storage).
- **Models run on your keys.** Voice and dictation go to OpenAI, and coding
  agents go to Anthropic or OpenAI, on the API key or subscription you
  saved, never ours.
- **Who else gets data.** GitHub for your repositories. Vercel runs our
  service and the sandboxes, and Neon hosts our database. PostHog gets usage
  data and screen recordings with every word masked. Sentry gets crash,
  error, and performance reports, which leave out what a model was sent or
  answered. Any integration you connect gets what your agents ask it. See
  [Who we send it to](#who-we-send-it-to).
- **Commands on your Mac.** Coding agents can run commands on your Mac, and
  what those commands print leaves it. See "Commands agents run on your Mac"
  under [What we collect](#what-we-collect).
- **Off switches.** Turn off "Share usage data" in Settings › Account, turn
  off "Let agents run commands on this Mac", disconnect any integration, or
  delete your account, which erases what our service keeps under it. See
  [Your choices](#your-choices).

## What we collect

**On your Mac.** Coding agents can run any shell command on your
Mac without asking you, and what it prints leaves your Mac (see "Commands
agents run on your Mac"). Apart from that, nothing in Luke reads a coding
agent session, message history, file contents, or command output from your
Mac's disk or from any other app, except a file you hand it to attach to a
coding agent's message (see "Files you attach to a coding agent"). The only
coding agents it lists are the ones started on a task from Luke — its Start
button, New coding agent, New voice chat, or another coding agent — which
our service runs in sandboxes of their own (see "Who we send it to"), and
the transcripts it shows, each a coding agent's or one of its workers', are
read from our service. Each coding agent reads a task's repository in its
sandbox on our service. No part of an agent runs on this Mac, so no
transcript, working memory, or inbox of one is held here on disk, and in
memory only the tabs described next. On disk, under its application data, Luke keeps only
the layout of its window: which tasks' tabs are open and which are pinned,
each pin with its label (a coding agent's title or a file's path), which
inbox items you have seen, and which groups you folded and how you sorted
the Inbox; and the words of a message you typed to a coding agent and have
not sent, mentions and skills among them, kept per agent until you send it
or empty its box, and an inbox answer you have not sent, kept per item until
you send it or the agent changes the item, each shown only while the account
that wrote it is signed in. The files attached to such a message or answer
stay in memory only.
None of it is sent anywhere.

**Run on this Mac.** Run, in an agent tab's ⋯, opens a terminal inside
Luke, in a tab of its side panel, on this Mac. Its shell clones the repository
from GitHub into Luke's application data the first time, with your own git
login, fetches the agent's pushed branch, checks it out in a worktree there,
runs the run command you set for that repository if you set one, and stays
open for you to type in. It runs as your macOS user in your login shell, and
reaches what you can. Each repository's run command is kept in this Mac's
settings, under Settings › Workspace › Repositories, and never sent anywhere;
what the terminal prints and what you type pass only between Luke's windows
on this Mac, are held in memory up to the latest 256 KB of output while the
tab stays open, and are never written to disk, logged, counted, or recorded.
Closing the tab, or quitting Luke, hangs up the terminal and everything it
started on it; the clone and the worktree stay until you delete them.

**Commands agents run on your Mac.** Every coding agent, and the workers a
coding agent hands work to, can each run any shell command on your Mac, at
once and without asking you,
as many at a time as they like. This holds whenever Luke is open on the Mac
and signed in to your account with Settings › This Mac › "Let agents run
commands on this Mac" on. The switch is kept on each Mac, not with your
account, and is on by default on every Mac, as is opening Luke at login. A
command runs in your login shell, from your home folder, as your macOS user,
with Luke's own environment, so it reaches everything you can: your files and
checkouts, your installed tools, and the network. Nothing is read into it, and
it is killed after 60 seconds, or after up to eight minutes when the agent
asks for longer; quitting Luke kills the commands still running, though a
process a command started apart from itself can outlive both. While the switch
is on, Luke on your Mac keeps a read open to our service for the commands your
agents queue, and our service records, once for your account, when a Mac of
yours last read, with nothing about which Mac. A command waits in our database
until a Mac takes it, and its answer until the agent has read it; both are
deleted as soon as the agent has the answer or stops waiting, though if our
service fails during that wait they stay until you delete your account. A
command no Mac takes within 30 seconds is not run, and the agent is told it
had no answer. The command, the few words the agent gave to describe it, its
exit code, and up to 20,000 characters each of what it printed to its output
and its error are returned to the agent; stored with the coding agent's
transcript, or its worker's, under its terms, and in the session history
described under "Who we send it to"; shown, marked "On your Mac", on a
worker's tab or the agent's tab on every Mac signed in as
you; and sent to the model provider that agent runs on. Nothing is redacted:
if a command prints a password, a token, a key, or a file's contents, all of
that goes too, and our operators can read it there like the rest of the
conversation. None of it is logged, counted in usage data, or written to a
trace. When two of your Macs are open, whichever takes a command first runs
it, and only that one. Turning the switch off, or signing out, stops that Mac
taking new commands at once: a command it already took is answered as switched
off, and one still running is stopped within about 20 seconds. For up to 45
seconds after the Mac's last read our service may still count it as listening,
and an agent is told its command was not run or had no answer; after that, it
is told that no Mac is listening.

**Your conversations with agents.** Nothing on your Mac writes what you said
or what the voice spoke to disk, and no record of what an agent did is kept
there. Opening a coding agent, yours or another member's, reads its
transcript (its words, reasoning summaries, and tool calls with their input
and output, and the lines said on its calls) for its tab, as it runs, and
opening one of its workers reads that worker's whole session for its own
tab. All of this is held in Luke's memory, never on disk, goes when you leave
the task or quit Luke, and is left out of the screen recording (see "Screen
recordings"). Your default model, effort, and
context size for a coding agent are kept with your account preferences on our
service, set in Settings › Coding agents or by the model you last started
with. The Claude model your Generate chapters runs on is kept with them too,
set in Settings › Coding agents. Where a Luke link you open in a browser goes, staying there or handed
to Luke for Mac, is kept with them too, set in Settings › Account; Luke in a
browser on a Mac reads it each time it loads a link that names something in
Luke.

A voice session on this Mac is a call into one coding agent of a task. It
opens with the task's plan, the lines said on earlier calls into that agent,
and what the agent has done lately, your newest typed messages to it among
them, so the voice can pick up where the agent stands. The agent answers each
spoken ask as a turn of its own conversation, with the tools it has on any
turn, and what was said on the call is kept in that agent's transcript. A
fixture or evidence run keeps no conversation at all.

**Your operator.** With the "Luke, your operator" experiment on, our
service keeps one coding agent of yours in each workspace, your operator,
with no task and no repository, to manage your other agents. It can read
what you reach in that workspace: the coding agents you can open and their
transcripts, the workspace's tasks, your inbox, and your direct messages in
the workspace's chat. Its own conversation, what you and it said, what it
read, and the tools it called, is visible in Luke only to you: no other
member of the workspace can list it, open it, read its transcript, message
it, call it, or find it in the chat, and your direct messages with it are
left out of theirs. The agents, tasks, pull requests, and posts it makes
are visible to the workspace as anyone's. It may also hand on a picture of
its own conversation, such as one it showed you, or of a chat message it
can read, to an agent it starts, as an image on that agent's first message.
A picture it hands on is then visible where it lands, as that agent's
conversation is: kept in that agent's transcript, which every member of the
workspace who can open the agent reads, and sent to that agent's model
provider with the rest of its conversation. The operator's conversation is
stored on our service like any coding agent's, bound to your account and
readable by our own operators. Deleting your account removes it.

**Tasks.** When you start a named task, our service stores it in a
workspace: the first workspace made for your account unless you start it in
another workspace you are a member of, and the task records which, and who
started it, named by their account's name to every member of the workspace. Every member of that
workspace can read, change, and delete the task, its board, its pages, and
its history, read what was said on its calls, yours included, and read,
message, rename, and stop the coding agents any member started on it. Each
message a member sends a coding agent keeps which member sent it, as their
account, and the agent's tab names them over it to every other member; a
message of a member whose account is deleted keeps no account and reads as a
former member's. A message that mentions another coding agent of the
workspace tells the agent it reaches that agent's task, branch, and pull
request, and how to message it, never its conversation. A coding agent can
also list the other coding agents of its workspace, on any task and whichever
member started them, send one a
message, list the workspace's open tasks, and start a new one on its own
task or another task of the workspace, handing it pictures of its own
conversation or of chat messages it can read as images on its first
message, without asking you first; a
message is kept in the receiving agent's transcript under the sending
agent's title, opening with the sending agent's title and id, and goes to
the receiving agent's model provider as the rest of its conversation does,
and an agent it starts runs as the member who started it, on that member's
keys, and is told which agent started it. It stores
under your account its name and its plan, one Markdown document, which begins as a copy of
your plan template and is written by coding agents started on it and by
you, when you edit a section or restore an
earlier version. Your edits are sent as you pause typing and when you finish;
unsaved words stay in Luke's memory on your Mac, never on disk. Our service
keeps the plan's history without limit: the document after each revision
(saves one writer makes close together count as one), who wrote it (you or
another member, editing or restoring which version, kept as that member's
account; or which coding agent; a revision a task's own Luke wrote, before
tasks lost him, keeps which member's call it was on) and
when, and who last changed each section and when, so Luke can say so beside
it, naming each member by their account's name to every member of the
workspace. A revision of a member whose account is deleted keeps no account
and names nobody. A coding agent's last fifty saves are also kept as its
notes, so the task's agents are told what it changed. All of it is stored as written,
bound to your account and readable by our own operators, like the
conversation described below. Luke on your Mac remembers, for each task, only
the time of its newest save when you last had it open, to show which sections
changed since.

Deleting a task removes it at once with its history, its inbox, and the
record of each coding agent started on it with the plan copy or prompt that
agent was handed, and marks each agent's transcript deleted, removed thirty
days later. The conversation a task held with its own Luke, before tasks
lost him, is already marked deleted, whether or not the task is, and is
removed thirty days after it was marked. Before it deletes anything, it
stops every coding agent of the task still at work, as Stop does; if one
cannot be stopped just then, or is still starting, the task is not deleted
and you can try again in a moment. It also deletes the record of each of the
task's calls, with every line said on it (see "Your account"): at once for a
call that has ended, and within a minute or so of its end for a call still
open. Deleting your account removes every task. Pinning or archiving a task
stores only when you did it and deletes nothing.

**A plan's pictures.** When you paste, drop, or choose a picture into a
task's plan, Luke re-encodes it on your Mac to at most 1.5 MB and sends it
to our service, which keeps it in our database beside the task, under the
task rather than your account, with which member added it. A coding agent on
the task may add a picture too: a PNG, JPEG, or WebP file of at most 1.5 MB in
its sandbox, such as a screenshot it took of what it built, which our service
reads from the sandbox and keeps the same way, as added by the member the
agent's turn runs for, with the plan's history naming the agent. The plan's text
names the picture by an address on tryluke.dev; our service serves its bytes
only to Luke signed in as a member of the task's workspace, and opening the
address in a browser shows a page that opens the task in Luke and nothing of
the picture. Every member of the workspace sees it, as they see the plan.
Pictures are stored as sent and readable by our own operators, like the plan.
The coding agents read the plan with each picture's line, its address, its
alt text, and its caption, but not the picture. A coding agent on the task
may look at one of the plan's pictures when those
words are not enough, read as the member the turn runs
for, which sends the picture to the model that looked; our service keeps
only that it looked in the agent's transcript, not
the picture, though the model's session history may keep it (see "Who we send
it to"). A picture stays as long as the task does, even once the plan no
longer shows it, so every earlier version still shows its pictures; one no save of the
plan ever showed, pasted and undone, is deleted a day after it was sent.
Deleting the task deletes its pictures; deleting your account leaves the
pictures you added to a task that stays, as it leaves the words you wrote.

**A plan's comments.** When you comment on a task's plan, our service keeps
the comment in our database beside the task, under the task rather than your
account: your words, which member wrote them and when, the words of the plan
the thread is on as they stood when it was started, where those words stand
in the plan now, and the section they stand in. It keeps the same of each
reply, edit, resolve, and reopen, and of every comment a coding agent on the
task writes, or a task's own Luke wrote before tasks lost him, naming the
member whose turn it ran on. Every member of
the workspace sees every comment, as they see the plan. Comments are stored
as written and readable by our own operators, like the plan. Deleting a
comment or a thread deletes it at once; deleting the task deletes all of its
comments; deleting your account leaves the comments you wrote on a task that
stays, naming nobody, as it leaves the words you wrote. The task's coding agents read the
open threads beside the plan, and a thread in which a member mentions one of
them with @ is handed to that agent whole as a request; either way the comments' words
and their writers' names go to that agent's model provider, as the plan does
(see "Who we send it to").

**Your plan template.** The template a new task's plan starts from is kept with your
account preferences on our service, as you write it in Settings › Plan
template (up to 20,000 characters; a built-in one until you do), sent as you
pause typing. Our service keeps its history without limit, as it does a
plan's: the template after each revision (your saves close together count as
one), whether you wrote it or restored which earlier version, and when, so
Settings can show and restore an earlier one. A new task's plan begins as a copy of
it; no model reads the template itself. Deleting your account removes it and
its history.

**What Luke remembers.** Where its developer turned on the Memory
experiment, as a coding agent works it may keep a fact or
convention its developer settled or it confirmed in the code, such as how
your team tests or ships, so later agents can recall it. Our service stores
each one under the workspace the agent works in, as a short statement in the
agent's words, with who it stands for (the member who started the agent that
kept it, or the one whose agent last corrected it) and when, readable by our
own operators like the transcript it came from; nothing asks you first. A
memory is the workspace's shared knowledge: any member's coding agent there
may read it, and Settings › Memory shows it to every member with your name on
it. No agent of another workspace reads it. Luke refuses to keep words that
look like a key, token, or password, and agents are told never to keep a
remark about one member as a shared memory. An agent keeps nothing on a turn an automation
started, Luke's own heartbeat included, or once that turn has read the web,
since neither's words are a member's. When Luke, your operator agent, starts
a fresh session, it is handed your workspace's most recent memories, your
private ones among them, beside what was said, as it would read them through recall. In Settings › Memory you can forget a memory
holding your words, and the workspace's owners and admins can forget any;
forgetting deletes it at once, so no later agent recalls it. Like a
project's history, a memory outlives the person who said it: leaving a
workspace, or deleting your account, leaves the memories you kept with the
workspace, and once your account is gone they no longer carry your name.
Deleting a task does not remove a memory kept while working on it, and a
workspace's memories go when the workspace does. A memory your Luke, the operator
agent of yours that keeps track of your other agents, keeps private, such as
your own preferences or what you are juggling, is yours alone: only your Luke
recalls it, since its conversation is the one no other member can read, while
your coding agents, whose transcripts your teammates can open, neither keep
nor recall one. Settings › Memory shows it to you alone, marked Only you, no
other member, an owner or admin included, can read or forget it, and it
leaves with your account when you delete it rather than staying with the
workspace.

**Pinned repositories.** When you pin a repository in the sidebar, our
service stores its name and when you pinned it under your account, so the pin
follows you to every Mac you sign in on. Unpinning deletes that record, and
deleting your account removes them all.

**Sidebar sections.** When you make a section in the sidebar, our service
stores its title, its icon (an emoji, or an icon's name and the color you
chose for it), its place among your sections, and the workspace
it is in under your account, and, for each task you put in it, which task and
when, so your sections follow you to every Mac you sign in on. They are yours
alone: no teammate sees them. Deleting a section deletes those records and none
of its tasks; they are not read while you are not a member of the workspace,
and deleting your account or the workspace removes them all.

**A task's inbox.** When a coding agent on a task needs a decision from you,
or something only you can do such as changing a GitHub setting, it posts an
item to the task's inbox on our service: a title, context in Markdown, links,
references to lines of its repository (a path, the lines, and the commit,
never the lines themselves), and how it asks to be answered, with any options
or form fields. An item may carry a picture the agent took in its sandbox,
such as a screenshot of a page it rendered, with the agent's description of
up to 300 characters, or a short video it recorded there of what it did, such
as clicking through a form it built: our service reads the file from the
sandbox, keeps the image, up to 1.5 MB, or the video, a WebM of up to 4 MB,
which plays where the item draws it, in our database beside the item, and
serves it only to Luke signed in as you. A video is what the agent's own
screen showed while it recorded, so it can hold whatever that screen did; it
is left out of the screen recording as the pictures are. Items and their pictures are stored under your account
and readable by our own operators, like the agent's transcript. The agent can
change or withdraw an item, and our service keeps each as it last stood; a
picture goes when the item stops naming it. Your answer, and any note, is
stored with the item under the account of whichever member gave it, which
every member of the task's workspace sees by name beside the answer, and,
where the agent asked to hear back, handed to it as one of your messages,
kept in its transcript. You can attach files to an answer as you can to a
message, on the same terms and bounds (see "Files you attach to a coding
agent"): an answer carrying one is always handed to the agent, and our
service also keeps each file, with its name, in our database beside the item,
where every member of the task's workspace can open it, until the answer is
taken back or the agent posts the item again. Any member of the task's
workspace can also add a message to an item's thread at any point, answered
or not, with files on the same terms: our service keeps the message's words
and files with the item under the account of the member who wrote it, which
every member of the workspace sees by name beside it, and hands it to the
agent as one of your messages, kept in its transcript. A thread stays until
the item is deleted with its task. While you are signed in, Luke
on your Mac keeps a read open to our service for every item waiting in your
workspaces, each in brief (its task, agent, title, and the account that started
the agent), and for every task holding an item; it counts in its sidebar and on
its Dock icon, and tells you of, only the items of agents you started. Opening the Inbox reads
each of those tasks' items whole, the ones you settled included, with what
each offered and the answer you picked; Luke holds them in memory only, never
on disk. While its window is behind, a Mac notification names a new item by
its task, agent, and title, and a coding agent's ended turn by its task, the
agent's title, and whether it finished or failed, or its branch's pull request
number, unless you turn these off in Settings › Coding agents; macOS shows and
keeps them as it does any app's. Deleting the task, or your account, deletes
its items.

**A workspace's chat.** A workspace has one chat on our service where its
coding agents and the people in it talk: a general
channel, a channel for each plan, channels a member opens on a topic, and
direct messages between two members, with replies in threads. Each member
has a handle our service makes once and keeps: yours is spelled from your
account's name. A message is stored with its words, any links, references to
lines of a repository (a path, the lines, and the commit, never the lines
themselves), the members it mentions, who posted it, where, and when; it may
also ask for an answer, with the answer and who gave it stored beside it. A
message may carry pictures, each up to 1.5 MB, which our service keeps beside
the message: one an agent took in its sandbox, which our service reads from
the sandbox, one a person posted from Luke's window, or one an agent passes on
from what it was sent. A coding agent's message may also carry a short video
it recorded in its sandbox, a WebM of up to 4 MB, kept the same way, which
plays in the chat, is left out of the screen recording, and is never handed
to a coding agent told of the message, which is told only that it is there. Every
message is stored under the workspace and readable by our own
operators, like an agent's transcript. Every person in the workspace can
read every channel and every direct message, one between two other people
included; a coding agent reads the channels and only its own direct
messages, and only a direct message's two members post in it. A coding
agent's turn may open with what was said in its chat since it last read,
sent to its model provider with the rest of the turn. A coding agent told of a
message, as a direct message, a mention, or a reply in a thread it is in
tells it, is sent the message's pictures with its words, as files you attach
are, up to ten and 3 MB together, each named by its id, and the rest named as
not attached; they go to its model provider and stay in its transcript with
the rest of the message. The member a plan's
Luke was in its chat, before tasks lost him, is deleted.
Deleting a plan deletes its channel with its messages, deleting your account
deletes your messages (others' replies to them stay), and deleting the
workspace deletes its chat. While you are signed in, the same read that keeps
your waiting inbox items carries what waits on you in chat: every open ask
someone else posted, and the last direct message or mention of you that you
have not read, each named only by who posted it, its plan, and its place,
never its words. While Luke's window is behind, a Mac notification says no
more than that, such as "@agent-2 messaged you" under the plan's name,
unless you turn notifications off in Settings › Coding agents. Luke in a
browser tells you of the same things, in the same words, through the
browser's own notifications, only while its tab is hidden and only once you
allowed them from Settings › Notifications; the browser shows and keeps them
as it does any site's, and nothing more leaves for it.

**Files you attach to a coding agent.** You can attach files to a coding
agent's message, to the prompt you start one with, or to an Inbox answer, by picking them with +,
dropping, or pasting: images, PDFs up to 3 MB, and text files up to 100 KB, up
to ten files and 3 MB a message. A PNG, JPEG, or WebP up to 1.5 MB is sent as
it is; any other image, or a larger one, is first made into a smaller WebP on
your Mac. Luke reads only the files you hand it and sends our service each
one's name and contents, including whatever the file carries inside it, such
as where and on what a photo was taken, but never where it was on your Mac.
Our service sends them to the agent's model with your message and with every
later call, and keeps them with the agent's transcript, readable by our own
operators. Each PNG, JPEG, or WebP is kept once, beside the transcript, as a
tool's pictures are (see "Pictures in a tool's answer"), and the transcript
names it by an id rather than carrying it; the agent is told that id, by which
it may hand the image to another agent, as a file of another agent's Start or
a picture of a chat message, on the same bounds as a file you attach. Any
other file, and an image not kept that way, such as one past the transcript's
200 MB of pictures, is stored in the transcript as sent, except that the
prompt an agent is started on keeps a PDF, or an image not kept, by name
alone. An agent that runs on Luke's own agent has its images and PDFs copied
into its sandbox too; one that runs on Claude Code or Codex is handed them in
its messages and never as files in its sandbox. They go when the transcript
does; the sandbox's snapshot and the agent's session history keep them on the
terms under "Who we send it to".

**Pictures in a tool's answer.** When a tool answers a coding agent
with a picture, as a connected service can answer a screenshot or an image
attached to an issue, the model that made the call sees it, and our service
keeps the picture once, a PNG, JPEG, or WebP of up to 4 MB, in our database
beside the agent's transcript the call is written to, which names the
picture by an id rather than carrying it; a transcript keeps up to 200 MB of
pictures. A larger picture, one past
that, or one of another kind is not kept, and the record says only its kind
and size. A coding agent or one of its workers can also show you pictures
from its sandbox, such as screenshots of a page it changed, up to twenty at a
time with a line of its own words each, and among them a short video it
recorded in its sandbox of what it did there, such as clicking through a form
it built, as a WebM of up to 4 MB, which the transcript plays where it would
draw a picture: our service reads each file from the sandbox and keeps it the
same way, beside the agent's transcript or the worker's, and the model is told
only that they were shown, never handed the pictures or the videos back. A
video is what the agent's own screen showed while it recorded, so it can hold
whatever that screen did; it is left out of the screen recording as the
pictures are. A coding agent's kept pictures, and its workers', are served only
to Luke signed in as a member of the workspace who can read the agent. Kept
pictures are readable by our own operators, like the transcript, and go
when it does.

**Your own API keys.** If you add an Anthropic or OpenAI API key in Settings,
your Mac sends it once, over HTTPS, to our service, which keeps it only if the
provider accepts it when asked for its list of models, a request that costs
nothing. It is stored under your account encrypted with AES-256-GCM, under a
key drawn for it alone that is itself encrypted under a server-only secret
held outside the database, so a copy of our database alone cannot read it; our
operators who hold both could. Beside it we keep the provider, a hint (the
`sk-` prefix and the word after it where it has them, and the last four
characters, such as `sk-ant-…abcd`), when you last saved it, and whether, and
when, the provider last accepted it, refused it, or said it was out of credit,
or our service could no longer read it, updated when a coding agent call on it
finds that changed. Every model call Luke makes for you runs on your own keys
and never on ours: a coding agent's and its workers' calls, Fast, and web
search on the key of the provider the model is on; voice calls and dictation
on your OpenAI key; and titles, pull request chapters, and the summary a
Continue or Fork writes on whichever of your keys there is. Without an OpenAI
key, calls and dictation are off; without any API key, an agent is titled from
the first words of its first message, and no chapters or summaries are
written. After you save it, neither your Mac nor any answer from our
service holds the key again, and we never log it or send it to our analytics,
crash reports, or screen recordings. Removing it in Settings, or deleting your
account, deletes it.

**Your ChatGPT plan.** Where Settings offers it, Sign in with ChatGPT signs
Luke in to your ChatGPT account through OpenAI's own page in your browser,
which hands a one-time code back to Luke on your Mac over a connection that
never leaves it (`127.0.0.1`). Your Mac trades that code with OpenAI for an
access token, a renewable refresh token, and an ID token, checks the ID
token's signature and that it was issued to Luke for this sign-in, and sends
them, with the client id OpenAI issued Luke and your ChatGPT account's id
(the ID token's subject), once, over HTTPS, to our service. It keeps nothing
of them itself. The service stores them under your account encrypted exactly
as your own API keys are, with the scopes OpenAI granted and when the access
token expires, beside a host id it made for your account, which names Luke's
hosted runtime to OpenAI and is kept after you disconnect. It renews the
access token with OpenAI as it nears its expiry. You are shown that you are
connected and when, never a token, and we never log one or send it to our
analytics, crash reports, or screen recordings. Disconnecting in Settings
asks OpenAI to end the sign-in and deletes it whether or not OpenAI confirms;
where OpenAI did not confirm, Settings says so, and you can remove Luke in
your ChatGPT settings to end it there. Deleting your account deletes it too.

**Your own GitHub token.** If you save a GitHub personal access token (classic)
in Settings › Profile, your Mac sends it once, over HTTPS, to our service,
which asks GitHub whose it is with one request and keeps it only if GitHub
accepts it, it carries the `repo` scope, and it belongs to the GitHub account
linked to yours; a fine-grained token is refused without being sent to GitHub.
It is stored under your account encrypted with AES-256-GCM, under the same
keys as your own API keys, so a copy of our database alone cannot read it.
Beside it we keep your GitHub login and account number, a hint (the `ghp_`
prefix and the last four characters), its expiry where GitHub gives one, when
you saved it, and whether GitHub has since refused it. You are shown the hint,
the login, and the expiry, never the token. Our service uses it only to call
GitHub for you: to list the repositories it can push to, and to read, check
out, commit to, and open pull requests on the repository of a task or coding
agent you start on it, where no GitHub App installation connected to the
workspace reaches that repository. Once a minute it reads the reviews, comments, and
checks on the open pull requests of your coding agents that run on it, to wake
those agents. It also asks GitHub whether your token can read the repository
of a teammate's task or coding agent that runs on their own token, to decide
whether you see it, and keeps that answer for up to an hour. In a coding agent's sandbox it is set at
the network firewall on that one repository's paths alone, and never enters
the sandbox, a command, or its output. After you save it, neither your Mac nor
any answer from our service holds the token again, and we never log it or send
it to our analytics, crash reports, or screen recordings. Removing it in
Settings, or deleting your account, deletes it.

**A task's whiteboard.** You and the task's coding agents can both draw on a
task's whiteboard. Our service stores it with the task, as drawn and readable
by our own operators: every shape, arrow, line, stroke, and piece of text and
where it stands, and the agents' latest drawing. Luke on your Mac
sends the whole board each time it changes and, with a save holding a new
drawing of the model's or one the model is waiting to look at, a picture of
the board as your Mac draws it, at most 1,200 pixels a side, kept in place of
the last one. The model reads the board as text at the start of a turn and
may look at that picture to check what it drew, which sends the picture to
the model; our service does not copy it into the agent's transcript,
though the model's session history may keep it (see "Who we send it to").
Each drawing call, with what it drew, is stored in the agent's transcript.
You cannot put an image or a file on the board. Deleting the task deletes its
whiteboard.

**How agents read your repository.** A task names a GitHub
repository of the Luke GitHub App installation connected to the task's
workspace. Each coding agent on the task reads and changes its code in a
Vercel Sandbox of its own: an isolated machine our service opens for the
agent's session, on Vercel's infrastructure, never on your Mac (see "Who we
send it to"). The tokens its checkout is made and pushed with are set at the
sandbox's network firewall and never enter the sandbox, a command, its
output, or the agent's transcript. Each command the agent runs, the few
words it gives to describe it, and what it printed are stored with the
agent's transcript, under its terms. The checkout stays in the sandbox
between turns and, once the sandbox is stopped, in a snapshot Vercel keeps
until thirty days after its last use. When an agent's transcript, or the
conversation a task's own Luke kept before tasks lost him, is removed,
thirty days after you delete its task, our service deletes the sandbox of
each of its sessions, with the snapshots no other sandbox uses, shortly
after; deleting your account does the same for every session of yours,
shortly after the deletion. A session an agent's conversation was moved off
earlier in its life is not tracked, and its snapshot stays until Vercel lets
it expire. The sandbox of each session a task's own Luke ran, before tasks
lost him, is deleted the same way, shortly after his conversation is removed.

**A coding agent that runs on Claude Code.** For the accounts in the early
test of Claude plans, a coding agent your Claude plan pays for runs on
Anthropic's Claude Code, and so does a Claude coding agent your own Anthropic
API key pays for, in that agent's own Vercel Sandbox, rather than on
Luke's own agent. Its sandbox's disk holds the agent's checkout of the
repository and Claude Code's own session files: its record of the session,
which it picks up again from there when the agent is next messaged. Both stay
on that disk between turns and in the snapshot Vercel keeps when the sandbox
stops, and are deleted with the sandbox when the task is deleted, as above.
Your plan's token, or your API key, is handed to Claude Code alone, in its
process's environment: it is never written to that disk, a command Claude Code runs,
or the conversation's record.

**A coding agent that runs on Codex.** On the same terms, for the accounts in
the early test of ChatGPT plans, a coding agent your ChatGPT plan pays for
runs on OpenAI's Codex, in that agent's own Vercel Sandbox, and so does a GPT
coding agent your own OpenAI API key pays for. Its sandbox's
disk holds the agent's checkout and Codex's own thread files (under its
`CODEX_HOME`): its record of the thread, which it resumes from there when the
agent is next messaged. Both stay on that disk between turns and in the
snapshot Vercel keeps when the sandbox stops, and are deleted with the
sandbox when the task is deleted, as above. Only the plan's short-lived
access token, never your sign-in's refresh token, is handed to Codex, in its
process's environment and on its input, or, for an agent your API key pays
for, that key, in its process's environment alone: neither is ever written to
that disk, a command Codex runs, or the conversation's record.

On either, what keeps the token from anyone with a Terminal in that sandbox
is not a missing `sudo`: Claude Code or Codex runs as a user of its own,
whose home no other user reads, and every Terminal shell, every command the
agent runs, and Claude Code or Codex itself start with every Linux capability
dropped, so none of them can read another process's environment or a file
kept from it, or become root.

**Code on screen during a call.** When a coding agent wants to
show you code, it names a file and lines, and our service reads them from
its sandbox checkout. The path, the commit the checkout read it at, the
line numbers, the lines (at most 200, each cut to 400 characters), and the
model's note on why it showed them (at most 280 characters) are stored with
the agent's transcript and sent to your Mac, which draws them in the task's
Code tab; nothing is read from
your Mac's disk. The service refuses a path outside the checkout and never
reads a file named `.env` or starting with `.env`. The voice model is told
the path and line numbers on screen, so the voice can refer to them. When you open
the task, Luke on your Mac reads back all the code shown on it, by the same
rules, and holds it in memory, never on disk, until you leave the task or quit
Luke. It is never part of the task's plan.

**A whole file opened from a snippet.** A snippet in the Code tab can open
its whole file in a File tab. Our service reads the file from GitHub at the
commit the agent's checkout read it at, or, for a file you open from the tree, a
skill, or code shown before that commit was recorded, at the head of the
default branch: it confirms the workspace's installation still reaches the
repository and mints a token for that one repository that reads its contents, used for that
read and never sent to your Mac, logged, or kept. The rules for code on
screen apply, and a link, a folder, a file over a megabyte, or one that is
not text is refused. The file is read 500 lines at a time as you scroll, is
not stored by our service, and is held by Luke only while its tab is open,
never on disk, except that copying or downloading it reads it whole (up to
that megabyte, lines uncut) and a download is written where you save it. The
File tab's tree lists the repository's folders and file names the same way,
through our service, which does not store them, and Luke holds them in memory
only; a `.env` file's name may be listed, though the file is never read.
An inbox item's line reference is read the same way, at the
commit the agent named, for the lines on the item and the File tab it opens;
nothing of the file is stored.

**A coding agent's pull request.** A coding agent's Pull request tab shows its
pull request as GitHub holds it, in two views. Each time a view first opens, or
you refresh it, our service reads it from GitHub with a token the Luke GitHub
App mints for that one repository on the workspace's installation. The overview
reads its title, branches, and whether it would merge, with how it may be
merged: the merge methods and auto-merge its repository allows, whether a merge
queue merges its base and its place in that queue, whether auto-merge is on,
its head commit, what its required reviews say, and its checks as one word; its description and up
to its 100 newest comments and reviews, each whole with its author, as GitHub
renders them; the name, App, state, and times of up to 100 checks on its head;
its reviewers; and up to its 100 newest review threads on lines, each with the
file and lines it is on, the part of the diff it was made on, whether it was
resolved or outdated, and up to its first 50 comments, each whole with its
author, as GitHub renders them; and the reactions on the description, those
comments and reviews, and those review comments, with up to 10 of who gave
each, except on a review comment, where only how many. Beside it, where you
hold a GitHub sign-in, our service reads with your own GitHub token which of
those reactions are yours, so the tab can light them; it keeps none of it, and
the answer is never kept for anyone else. An image in the description or a comment is read by our
service too, never by your Mac: an upload with the same one-repository token,
through a fresh signed address GitHub gives for it, and any other image through
GitHub's own image proxy, each up to 8 MB; other images are shown as links.
Files changed reads each changed file's name and patch, for up to 300 files,
leaving out a patch over 100,000 characters. It stores none of it, and Luke
holds it in memory while the tab is open, never on disk, except that
downloading a patch writes it where you save it. Chapters splits the pull
request into chapters only when a member presses Generate chapters, or
Regenerate once its head has moved on; nothing makes them on its own. Our
service then reads the pull request's title, description, the messages of up
to its first 100 commits, and each changed file's patch as Files changed
reads them, and sends all of it, except the patches of files a reader reads
past (lockfiles, minified files, source maps, snapshots, images, fonts,
videos, and documents) and of files with no patch to read, to the Claude model
the member who pressed it chose in Settings › Coding agents (Haiku 5.5 unless
they changed it), on our own key, never yours and never counted in your daily
usage, as described under "Who we send it to".
It stores the chapters that come back with the workspace, for that repository,
pull request, and head commit, beside which member asked, when, the model
that answered, and why a generation failed where one did: each chapter's
title, summary, risk and reasons, the questions it puts to a reviewer, and the
file paths and line numbers it covers, never a patch, the description, or a
commit message. Every member of the workspace who can reach the repository
sees them, and a Generate for the same head replaces them. They are deleted
when the workspace is; nothing else deletes them, so they stay after the pull
request closes, after a newer head's chapters are made, and after the member
who asked deletes their account, which only clears who asked. A button in the tab that
changes the pull request, such as Ready for review, Convert to draft, Merge,
Enable auto-merge, or giving or taking back a reaction, is
sent to GitHub by our service as you, on the token of your own GitHub sign-in,
whoever started the agent, so it can do only what your GitHub account may; it
is never sent as the Luke GitHub App, and where you hold no GitHub sign-in
GitHub takes, nothing is sent and the tab asks you to sign in with GitHub
again. Files changed's Viewed boxes are GitHub's own, which GitHub keeps for
each account: our service reads which files you marked viewed, and marks or
unmarks one when you press its box, on the same token of your own GitHub
sign-in and never as the Luke GitHub App, and stores none of it. Wherever Luke names someone on
GitHub, as the tab does who opened, reviewed, and commented on the pull
request, it draws them by their GitHub avatar, which your Mac loads straight
from GitHub's avatar host, as github.com does, so GitHub sees your Mac's IP
address.

**Your repository's skills.** A repository can hold agent skills, Markdown
instructions in `.agents/skills/` or `.claude/skills/`, each in a `SKILL.md`.
When a coding agent's session starts, our service
reads them from GitHub at the head of the default branch, with a token for
that one repository: up to 64 skills, leaving out a file over 64 KB. The
coding agent is told each skill's name and
description, and reads a skill's whole file when it loads one, which you can
ask for by typing `/` and its name in a coding agent's message box; a load is
stored with the agent's transcript like any tool
call. Luke on your Mac reads each skill's name, description, and path through
our service, read from GitHub the same way, never its file, to list after `/`,
and holds them in memory only; a skill named in a message opens its file in a
File tab, by the rules above. Our service keeps no copy of the skills
themselves.

**Security ratings of skills you add.** When you paste a `skills add`
command into Add skill, our service reads the repository it names from
GitHub to show you its skills. Where GitHub says that repository is public,
it also asks skills.sh, Vercel's skills directory, for its partners'
security ratings of the skills shown in detail, as the `skills` command
does: it sends the repository's owner and name and those skills' names, and
nothing about you. It never asks for a private repository, and keeps
nothing of the answer past showing it.

**Pages an agent makes.** Coding agents can make a
page for a task: an interactive HTML document, such as a chart or a mockup,
that opens in the task's side panel. Our service stores each page with the
task, as written and readable by our own operators: its title and HTML, at
most 262,144 characters a version, and every version it has had, each kept as
written and never changed, with which coding agent showed it, or Luke, for
a page a task's own Luke showed before tasks lost him.
Deleting the task deletes its pages. Coding agents can also read a page of
any task of the workspace by its
id, as a mention of the page points them to it: its HTML, at most 40,000
characters of it, is then sent to that agent's model as part of its
conversation. Luke
on your Mac reads a page's HTML from our service only to draw it, in its tab
or in the card over its tab, its row, or a chip naming it, holds it in
memory only, and never passes it to the rest of the panel. A page runs sealed
off from Luke: it cannot read the panel, your account, or another page, and
cannot store anything, open a window, or send anything anywhere but the
requests it makes to the one place it may load from, cdnjs.cloudflare.com, for
code libraries such as charts and diagrams, which Cloudflare's CDN then sees
requested from your Mac's address. A link inside a page does not open. A page
is never shared or published: only you can open it, from Luke.

**Agents' working memory.** Each coding agent works
from a session history of its own turns — the model's record of what it read,
said, and did, folded into a written summary when it grows long — kept by
Vercel Workflow for our service on the terms under "Who we send it to"; our
database keeps the record of each turn described under "Your account", from
which a new session picks up. None of it is held on your Mac, in memory or on
disk.

Earlier versions kept the conversation, Luke's working memory, the things
it remembered about you, and a search index over its workspace files in a
database under Luke's application data (`agents/main/agent.sqlite`, with
recovery archives under `archives/`), and versions before those in three
files beside your settings. This version reads and writes none of them, so
all of that starts over on our service. Each launch removes the database and
its archives if it finds them; the three older files stay until you remove
them.

Luke's runtime runs inside the app. It holds your settings, the encrypted
credentials (decrypted where it runs, under the same Keychain entry), and your
account's session, while the part that draws listens, speaks, holds the keys,
and asks the runtime for everything else. Nothing about you crosses that
boundary that the panel did not already draw; no stored key, token, or account
secret travels in any answer or event, and the voice window is handed no
credential — the runtime opens each voice session and hands the window only
the connection answer it needs to hear and be heard. Quitting Luke cancels
what was running, commands agents run on your Mac included, and writes down
what did not finish rather than finishing it. Beside those commands and the
files you attach, the one thing the app does on this machine at the runtime's
ask is open an address you asked to open.

**Your account.** Signing in with Google or GitHub gives us your name, email
address, the address of your profile picture, and which of the two you used.
An account made with Google can also link a GitHub account to itself, even
one under a different email address, in Settings › Integrations, which lets
agents use GitHub tools as you, lets our service open the pull request
of a coding agent you start as you, and lets it change a coding agent's pull
request as you when you press a button in its Pull request tab; signing in with GitHub, or linking it,
authorizes the Luke GitHub App: its token reaches only
repositories where you installed the App and can already see, with the App's
permissions (reading a repository's details; reading and writing its contents,
pull requests, issues, and discussions; reading its checks, commit statuses,
and Actions runs with their logs where the installation has accepted them;
and reading your email addresses), and none until you install it. We keep that token and its refresh
token sealed under a server-only secret, read them only on our service, and
never hand them to your Mac, a browser, or anyone else; they go when you
delete your account, and you can revoke the App in GitHub's settings under
Applications, where an account that signed in before the App may also hold
an unused `repo` permission to revoke. When you revoke it, GitHub tells us,
and we delete that GitHub link's tokens. We keep the link itself, which
holds only your GitHub account's number, so signing in with GitHub again
finds your account even if your GitHub email changed; your account keeps
any other way you sign in. Signing in with Google leaves us
Google's sign-in tokens, kept on our service and used for nothing after the
sign-in. Your own GitHub is not how Luke reaches a workspace's
repositories: they are those of the GitHub installation connected to the
workspace, read from GitHub with tokens the App mints for that installation
when you choose one, and nobody's own GitHub account decides what a
workspace reaches. We also keep the records
that keep you signed in, each with the network address and the browser or app
it was signed in from, and a daily count of your use of our service, one
number a day: one for each voice session you opened and each clip you
dictated;
beside it, how many seconds you dictated.

Luke's own maintainers can see your name, email address, profile picture,
sign-in method, whether you are an administrator, when you joined and were
last active, and your daily counts, and the names of your workspaces and
their members, roles, invitations, connected integrations, GitHub
installation, and activity counts, on an admin page that only an account we
have marked as an administrator can open: on our site, and in the Mac app and
the web app, where it reads the same answers through the app's own
connection to our service. Beside them it shows
how many tasks you created and minutes of calls you held over a window; your
coding agents, each with when it started, the repository it works in, its
model and effort, whether it is running, finished, or failed with the fixed
word for why, and whether its pull request is open, merged, or closed; which
providers you saved a key for or connected, and whether each key or
connection works; your coding-agent model and effort, and the experiments
you turned on; and when a call of yours dropped or an automation of yours
failed to start, with the fixed word for why. For the most active accounts it
also shows how many coding agents you started and pull requests of theirs
merged, on how many days you created a task, wrote a plan revision, started
an agent, or held a call, and when you last signed in. Counted across all
accounts, never named to one, it shows how many plan revisions, inbox
answers, and automation runs there were, and how many accounts posted in a
workspace's chat, have GitHub connected on a workspace, have an integration
connected, or opened or merged a pull request.
Across every account, the same page counts how many of Luke's turns, coding
agents' runs, calls, and automation runs ended and how many failed, were
dropped, or were skipped, each by the fixed word the service records for why.
Where one of your own API keys stands refused, out of quota, or unreadable,
one of your integrations stands expired, or a workspace you belong to has its
GitHub installation suspended or removed, the page lists your account with
which provider or integration it is and that status, when it last changed,
and how many of your coding agents failed in the past week; that list names
no workspace and no repository. The same page shows the service's use at
public list prices, a figure for comparison and not what we are billed,
from the model tokens each turn recorded and the seconds of voice,
dictation, and video avatar it metered: mostly as totals across every
account, and, for the accounts whose use comes to the most at those prices
over the days chosen, what each one's use comes to, how many tokens of it
no price was known for, and how many of its coding agents' pull requests
merged. Past those names, nothing you
type, say, or run appears on it: no task's title, plan, prompt, or message,
no pull request's title, no key, and no error's own words.

Every account also gets a first workspace on our service when it signs in, a
record named with your name and holding you as its owner, which is otherwise
like any workspace you create: you can invite people to it, and it stays when
you delete your account, as every workspace you own does, with only your
membership removed. A workspace you create is a record
named as you name it, holding you as its owner; every member of a workspace
sees every other member's name, email address, and
role in it, and an owner or admin of it can remove a member. A workspace may
show a photo an owner or admin of it uploads: the service keeps it with the
workspace, a PNG, JPEG, or WebP image, and serves its bytes only to Luke
signed in as one of the workspace's members, never caching it on the way;
the list of your workspaces names only a short digest of it, so your Mac
reads the photo again only when it changes. The photo is the one picture
you choose, which your Mac first redraws as a small square, 256 pixels a
side, and sends nothing else of the file; an owner or admin who removes it
deletes it from the service, and a new upload replaces it. Your own first workspace, while
it has no photo, shows your profile picture, from the address your sign-in
gave us where it is Google's or GitHub's, and only to you. When an owner
or admin connects GitHub to a workspace, the
service keeps beside the workspace GitHub's ids for that installation and the
account it is on, its login, whether it is a user or an organization, and
whether the installation is active, suspended, or removed. To confirm the
installation is one the person connecting it can see, GitHub asks them to
authorize the Luke GitHub App once; our service uses the one-time token that
gives it to read their installations once, then revokes it, and keeps nothing
of it or of that read. While a connect is under way it keeps, for at most an
hour, a one-way digest of the connect link's random code beside your account
and the workspace, the installation GitHub named, and the random code that
proves the authorization is the one it asked for.

The service also keeps your conversations with your coding agents. Each
turn an agent runs for you writes to our database your message or spoken ask
as given; its reply, the summaries of its reasoning, and each tool call with
its input and result; and the turn's model and effort, token counts, and
when it was queued, started, and ended, and how (rows from earlier versions
may also hold the ids of OpenAI's responses, and the turns a task's own Luke
ran before tasks lost him). On a call, what you said is kept as your line
and what the voice said as its own, in the transcript of the agent you
called — an answer it gave without a turn, what it said around one, a reply
it read aloud — each written once it has settled, so the record holds the
words you heard beside the turns the agent ran. Each call also keeps a
record of its own: its task and its agent, OpenAI's id for the session, when
it started and ended and why, its voice model, its billed seconds (or our
own count where OpenAI gave none), and each line said on it, by whom and
when; the agent's tab shows it. A call made before calls were made into an
agent, when a task had its own Luke, keeps its record without the lines said
on it, which are deleted. These rows are not sealed: they are stored
as written, and our own operators can read them. They stand until you delete
your account, which removes them at once. A deleted task's agents'
transcripts are marked deleted and removed thirty days later, as is every
conversation a task held with its own Luke before tasks lost him (see
"Tasks"); its call records, with the lines said on them, are deleted with
the task, or within a minute or so of the call ending for a call still open.

**Linear, if you connect it.** Connecting Linear in Settings › Integrations
signs you in to Linear in your browser through Vercel Connect, which stores
Linear's token for your account, encrypted, and renews it. Our service never
writes the token down: it gets it from Vercel Connect when an agent uses
Linear, or when a coding agent's MCP menu lists Linear's tools, holds it in
memory for a short while, and sends it only to Linear's MCP server, never to
your Mac, a model, or a sandbox. We keep only your connection's state
(waiting for sign-in, connected, or expired), when it last changed and last
finished signing in, and, while a sign-in is under way, when it began and a
one-time value that matches its return. Where you connect more than one
account at one service, we also keep a name for each: the name the service
gives that account's workspace when Vercel Connect hands us its token, or one
you give it in Settings › Integrations. An agent handed more than one account
at a service is told each one's name, so it can ask which you mean and say
which it used. The list of Linear's tools that menu
shows is held in our service's memory for five minutes. While you are
connected, every coding agent and its workers can read and change whatever
your Linear account can, through Linear's own MCP server, without asking you
first, unless you switch Linear off for that agent in its message box's MCP menu,
which takes effect from its next turn and is stored with the agent. A
message to the agent from a member of the workspace or Luke, or an
automation's own prompt (never a webhook body or a GitHub event's words),
that mentions Linear, one of its tools, or one of its pages hands it Linear
for the turn that message opens, or, sent while a turn is under way, for its
next one, even while Linear is switched off for that agent, and leaves the
switch as it is; a message from another coding agent or a reviewer hands it
none. The workers are told to change
something only when their subagent task asks for
it. What Linear answers goes to the model that made the call, and each call,
with its input and everything Linear answered, is written to the agent's
transcript like any other tool call. Disconnecting stops Luke
using it from each agent's next step, removes the connection's record, and
asks Vercel Connect to revoke the grant; what agents already changed in
Linear, and the record of it, stays. Deleting your account removes the record
and asks Vercel Connect to revoke the grant in the same way; if Vercel Connect
cannot be reached then, your account is deleted all the same and the grant
stays until you revoke Luke in Linear's own settings.

**Linear for a whole workspace, if an owner or admin connects it.** An owner
or admin can also connect Linear once for everyone in a workspace, in Settings
› Workspace › Integrations. That signs them in to Linear in their browser
through Vercel Connect, which stores the Linear token under the workspace
rather than under their account, and our service handles the token as it
does an account's, sending it only to Linear. We keep the workspace
connection's state, who last began its sign-in, when it last changed and last
finished signing in, and, while a sign-in is under way, when it began and a
one-time value that matches its return. While it is connected, every member
of the workspace can list the issues that Linear account can see, private
teams' issues included, and start a plan from one, and Luke's agents working
on that workspace's plans and coding agents use this connection for Linear in
place of a member's own, so what they change in Linear shows as made by the
person who connected it. Starting a plan from an issue copies the issue's
key, title, address, and description onto the plan, where it stays with the
plan, is handed to the plan's coding agents with the task, and is
deleted with the plan. Once you pause typing in New task's name field, what
you typed is sent to Linear through this connection as a search, or, where it
is an issue's key or a link to one, as a read of that one issue; neither what
was sent nor what Linear answered is kept. Where a plan, a reply, or an Inbox item shows a link
to a Linear issue, the app asks our service for that issue's key, title,
state, and assignee's name, which it reads through this connection as you
look and keeps nowhere; the app shows them on the link, and they go no
further. The connection read through is that of the workspace the words belong
to: a
plan's, or an Inbox item's own, its plan's or its agent's, never the
workspace the Inbox happens to list; an item whose workspace is not known
reads nothing.
Disconnecting stops every read through it at once,
removes the connection's record, and asks Vercel Connect to revoke the grant;
what plans already copied of an issue stays with them.

**Notion, if you connect it.** Connecting Notion in Settings › Integrations
signs you in to Notion in your browser through Vercel Connect, which stores
Notion's token for your account, encrypted, and renews it. Our service
handles the token as it does Linear's, and keeps the same record of your
connection. While you are connected, every coding agent and its workers,
as for Linear, can read, create, and
change whatever your Notion account can, through Notion's own MCP server,
without asking you first. What
Notion answers goes to the model that made the call, and each call, with its
input and everything Notion answered, is written to the agent's transcript
like any other tool call. Disconnecting and deleting
your account work as they do for Linear: Luke stops using it from each agent's
next step, removes the connection's record, and asks Vercel Connect to revoke
the grant; what agents already changed in Notion, and the record of it, stays,
and a grant Vercel Connect could not revoke stays until you remove Luke in
Notion's own settings.

**Sentry, if you connect it.** Connecting Sentry in Settings › Integrations
signs you in to Sentry in your browser through Vercel Connect, which stores
Sentry's token for your account, encrypted, and renews it. Sentry's sign-in
lists what Luke may do, reading issues and events among it, and you can untick
its write access there to keep Luke to reading. Our service handles the token
as it does Linear's, and keeps the same record of your connection. While you
are connected, every coding agent and its workers, as for Linear, can do whatever your Sentry grant allows, through
Sentry's own MCP server, without asking you first. What Sentry answers, which
can include the error messages, stack traces, and event data your applications
sent it, goes to the model that made the call, and each call, with its input
and everything Sentry answered, is written to the agent's transcript like
any other tool call. Disconnecting and deleting your
account work as they do for Linear: Luke stops using it from each agent's next
step, removes the connection's record, and asks Vercel Connect to revoke the
grant; what agents already changed in Sentry, and the record of it, stays, and
a grant Vercel Connect could not revoke stays until you revoke Luke in
Sentry's own settings.

**Slack, where it is offered.** Our service does not offer Slack yet:
Settings › Integrations shows it as not available, it cannot be connected,
and an agent's Slack call fails before any token is read, so nothing reaches
Slack. Where a deployment of our service offers it, connecting Slack in
Settings › Integrations signs you in to Slack in your browser through Vercel
Connect, which stores Slack's token for your account, encrypted, and renews
it. While you are connected, the agents, as for Linear, can do whatever your
Slack grant allows, without asking you first: search messages, files,
channels, and people, read channels, private channels, direct messages,
threads, canvases, and profiles, with people's email addresses, that your
Slack account can see, and send and schedule messages, react, and write
canvases as you. Our service handles the token as it does Linear's, and keeps
the same record of your connection; which agents can use Slack is as for
Linear. What Slack answers, which can include other people's messages in
conversations you can see, goes to the model that made the call, and each
call, with its input and everything Slack answered, is written to the
agent's transcript like any other tool call.
Disconnecting and deleting your account work as they do for Linear: Luke
stops using it from each agent's next step, removes the connection's record,
and asks Vercel Connect to revoke the grant; what agents already sent or
changed in Slack, and the record of it, stays, and a grant Vercel Connect
could not revoke stays until you remove Luke in Slack's own settings.

**Granola, Mercury, Neon, PostHog, Supabase, Vercel, and Y Combinator, if you
connect them.** Connecting one signs you in to it in your browser through
Vercel Connect, which stores its token for your account, encrypted, and renews
it. Our service handles each token as it does Linear's, and keeps the same
record of your connection. While you are connected, the agents, as for
Linear, can do whatever your grant at that service allows, through its own
MCP server, without asking you first: read and change your Granola meeting
notes and transcripts; read your Mercury accounts, balances, transactions,
cards, recipients, and statements, with account and routing numbers,
categorize and annotate transactions, and request payments and transfers,
which an approver still confirms in Mercury; manage your Neon and Supabase
projects and databases and run SQL on them; query and change your PostHog
analytics, feature flags, and experiments; manage your Vercel projects,
deployments, domains, and environment variables; and use Y Combinator's
Bookface as your YC account can. What a service answers can include a
credential it hands out, such as a database connection string or password, a
decrypted environment variable, or an API key; like everything else it
answers, it goes to the model that made the call, and each call, with its
input and everything the service answered, is written to the agent's
transcript like any other tool call.
Disconnecting and deleting your account work as they do for Linear: Luke stops
using it from each agent's next step, removes the connection's record, and
asks Vercel Connect to revoke the grant; what agents already changed there,
and the record of it, stays, and a grant Vercel Connect could not revoke
stays until you remove Luke in that service's own settings.

**Executor, if you connect it.** Executor (executor.sh) is a gateway to the
apps you set up in it: other services' MCP servers and APIs, skills, and
automations. Connecting it signs you in to Executor in your browser through
Vercel Connect, for the one Executor organization you pick there, and Vercel
Connect stores its token for your account, encrypted, and renews it. Our
service handles the token as it does Linear's, and keeps the same record of
your connection. The credentials of the apps you set up in Executor stay in
Executor, which attaches them to each call itself; Luke never receives them.
While you are connected, the agents, as for Linear, can do whatever your
Executor grant allows, without asking you first: read the apps' skills, search
their tools, and call them or run a script over them, writes included. A call
that Executor's own policy holds for your approval, or that needs your input,
comes back to the agent as a question, which it puts to you, and the call goes
on only with your answer. What an app answers, which can include a credential
that app hands out, goes to the model that made the call, and each call, with
its input and everything Executor answered, is written to the agent's
transcript like any other tool call. Disconnecting
and deleting your account work as they do for Linear: Luke stops using it from
each agent's next step, removes the connection's record, and asks Vercel
Connect to revoke the grant; what agents already changed through Executor, and
the record of it, stays, and a grant Vercel Connect could not revoke stays
until you revoke it in Executor's own settings.

**GitHub, if you signed in with GitHub.** GitHub needs no connecting of its
own: while your GitHub sign-in stands, every coding agent and its workers,
as for Linear, can do whatever the Luke
GitHub App's token allows, through GitHub's own MCP server
(`api.githubcopilot.com`), without asking you first: read and change
repositories, files, branches, issues, pull requests and their reviews,
discussions, and Actions runs where the App is installed and you have access.
Our service reads that token from where your sign-in left it, as it does for
everything else it reads from GitHub, sends it only to GitHub's MCP server,
never to your Mac, a model, or a sandbox, and keeps no other record of the
connection. What GitHub answers goes to the model that made the call, and each
call, with its input and everything GitHub answered, is written to the
agent's transcript like any other tool call. An account
that signed in with Google alone is offered Connect on GitHub's row in
Settings › Integrations instead, which connects it, and Disconnect there
ends it. Luke
stops using it when your GitHub connection ends: when you disconnect it,
revoke the App in GitHub's settings, or delete your account; what agents
already changed on GitHub, and the record of it, stays.

**Usage data.** We count how Luke's features are used on the Mac, and attach
your name and email to that record. The counts are event names and values from
a fixed list. A voice session's start is counted with the source that opened
it, our voice service on your account, and never with a session id. A count
made before you sign in waits in Luke's memory and is sent under your account
if you sign in before Luke quits, and is dropped otherwise. The mark that you
used Luke on a day is counted once a day for each account signed in, so Luke
keeps in its settings file on your Mac, for each account it was sent for, the
email address and the UTC day it was last sent, and only the newest day; it is
never sent anywhere. Nothing you type
or say and nothing from a session can appear in one: no titles, branches, file
paths, prompts, or error text. Each count also carries Luke's version, whether
it is a released build or a development one, and which deployment of our
service recorded it. Settings › Account › "Share usage data" turns these
counts off (see "Your choices").

Our service also counts, under the same account, the work done through it:
a task or a workspace made (with where it was started from and whether from an issue), a coding agent started (with the model and effort
it runs on, and whether an automation started it), a pull request an agent
opened (as you or as Luke's GitHub App, and whether as a draft), an Inbox item
answered, a Chat message you posted, an issue filed, an automation made (with
what triggers it), an integration connected or disconnected (with which
provider), and a pull request's chapters generated (with how it came out, how
many chapters and parts of the diff they hold, and how long it took). These counts are event names and values from a fixed list too, and
carry no titles, names, repositories, branches, prompts, messages, or the
words of any of them. They go from our service to PostHog, so PostHog never
sees your network address for them, and deleting your account erases them
with the rest of your usage data.

**Screen recordings.** Luke records what his own panel draws, never your
screen, your editor, your terminal, or any other app, and records its shape,
not its words: before it leaves your Mac, every piece of text, and every
label, description, picture address, and link address a page carries for
itself, is replaced with blocks of the same length, so a task's plan, a
line of what you or Luke said, your name and email address, and anything
you type all appear as blocks. A coding agent's message box is an editor, and
the words in it and a skill chosen there are text it draws, which appear as
blocks too; no chip carries what it names anywhere else. As a second line, some parts are left out
whole: the feedback form, since a screenshot you attach could carry another
app's words; a task's title while you edit it, its plan while you edit it,
its whiteboard, its Call and Code tabs, the contents of its File tabs with
their tree, its pages, and its version history with the earlier version you
are viewing; an Inbox item's body and pictures; the messages in Chat; each coding agent's and
worker's tab, with its Changes tab, its Terminal tab, message box, menus of
skills and MCP servers, and the files you attach there; a Browser tab, with
the live view of its page; code drawn in a
transcript; the API keys and Plan template pages of Settings; an automation's
webhook secret, the one time it is shown; the admin page in the app, which
only our maintainers can open and which names other people's accounts; and the cards
that open over a row or a chip on hover, a page's preview among them. The
whiteboard and a Terminal tab's shell draw their words as pixels, which the
masking cannot reach, so leaving them out is
their only line, and recording what a canvas draws is switched off. A mention drawn as a chip carries what it names, such as a
plan section's heading, only in its words, never in an attribute the masking
leaves, so the recording keeps its shape alone. Luke does not report what you
clicked. Each recording carries Luke's version and whether it is a released
build or a development one; only a released build records at all.

**Tab switcher previews.** When you hold ⌃Tab in the Mac app, each card shows a
small, downscaled still of a screen you visited, taken by the app as you
settle on it and as ⌃Tab leaves it. Those stills stay in that window's memory
while it is open, a few at a time: they are never written to disk and never
reach our service, a trace, a counted event, or the voice window, and the
screen recording leaves them out.

**Browser tabs.** With the Browser tab experiment on, a Browser tab shows an
agent's cloud browser, which the agent drives and you can watch and take over.
The cloud browser is a Chromium that runs in the agent's own Vercel Sandbox,
never on your Mac, so it reaches that sandbox's own `localhost` and holds none
of your Mac's cookies or signed-in sites. What the agent does with it reaches the model:
each page's address and title, a screenshot, and a text snapshot of the page;
the transcript keeps these, under its terms. A screenshot is taken twice: the
model is handed a small copy, which the stored transcript leaves out, and our
service keeps a full-size copy, the page at its own size as a JPEG or a PNG of
at most 1.5 MB, in our database beside the transcript the call is written to,
the agent's or its worker's, as it keeps the pictures an agent shows you (see
"Pictures in a tool's answer"), under the same 200 MB a transcript keeps. The
transcript names it by an id and shows it as a thumbnail that opens full size,
to Luke signed in as a member of the workspace who can read the agent, which
is each member who can open the task. Kept screenshots are readable by our
own operators, like the transcript, and are deleted with it: deleting the
agent or its task marks the transcript deleted and removes it, with its
screenshots, thirty days later, and deleting your account removes them at
once. Our service keeps the task's list of cloud
tabs, each one's address and title, with the agent whose browser holds it,
until that agent's conversation is removed. The agent can also record the
browser as a video, for up to two minutes at a time, to show you a flow it
built or tested: a recorder in its sandbox writes what the browser draws to the
sandbox's disk, where it stays until the next recording replaces it or the
sandbox's snapshot is deleted, and once the agent stops it our service keeps the
video, a WebM of up to 4 MB, beside the transcript as it keeps a screenshot,
shown to the same members, readable by our operators, and deleted with the
transcript on the same terms; the model is told it was kept, never handed the
video, and the screen recording leaves out its player. The agent may also post
such a recording to the task's inbox or its workspace's chat, where it is kept
and shown as any video an agent posts there is (see "A task's inbox" and "A
workspace's chat"). Apart from such a
recording, the page and its live-view frames
are not kept by us: the frames pass through our service
to the panel of each member who opens the task, and every such member can
watch the tab and take it over by clicking and typing in it, and the agent's
actions on it wait while you do. Nothing of it reaches a trace, a counted event,
a fixture, or the voice window, and the screen recording masks the live view
and the transcript's screenshots.
The browser's profile, with the cookies and logins you type into it, lives on
the sandbox's disk, so it stays in that sandbox while it runs and in the
snapshot Vercel keeps when the sandbox stops, until thirty days after the
snapshot's last use, as the checkout does under "How Luke reads your
repository"; the pages open at a stop are not kept, and the browser reopens
each tab at its last address on resume. No other agent reaches that profile;
an agent's workers share its sandbox, so they share it. Deleting the task, or
your account, deletes the sandbox and its snapshot as described there.

Recording starts just after the panel first draws when Luke opens, before
you sign in, so it covers the signed-out panel and the sign-in. A recording
that begins before you sign in is attached to your account if you sign in
while it runs; one that never reaches a sign-in belongs to nobody, so
deleting your account does not reach it — we have no way to tell it was
yours.

**Crash and performance reports from the Mac app.** In ordinary runs, Luke
sends Sentry reports of unhandled exceptions in its Electron main, preload,
and renderer code, and of the errors it caught but could not recover from: a
launch that could not start, a window whose state could not be read, and an
internal error in an action, a background task, or a part of Luke shutting
down. It also sends process-session status, and native minidumps when an
Electron main, renderer, or GPU process crashes. It also sends performance
traces for about one launch or page load in ten: how long Luke took to start,
how each window's page loaded, and the requests each made. Luke uses Sentry's
default data collection, so reports and traces carry the exception message
and code path, breadcrumbs (among them messages Luke wrote to its console and
the addresses of requests it made),
the headers, bodies, and query parameters of requests Luke made, Electron,
operating-system, runtime, and device context, and your Mac's IP address.
Sentry replaces a value whose name looks like a credential, such as an
authorization header or a token parameter, before it is sent. Luke drops any
error report or breadcrumb that names a call's avatar access token, and any
traced step whose name or request address names that token as it starts; in
the rest of a trace, a name or a value that names the token is replaced. In
the address of a request or of the page that a trace carries, the value of
each query parameter and the fragment are replaced, and so is any part of its
path shaped like a credential, such as a long token; the scheme, the host, the
rest of the path, and the parameters' names are sent as they were. Luke does
not attach your Luke account, and does not enable Sentry Replay, screenshots,
or profiling.
Fixture and evidence runs send nothing to Sentry.

**Error, performance, and agent reports from our service.** Our service and
Luke's agents send Sentry reports so that we can find and fix failures. Our
service's web functions send every error they did not handle or that ended
work they run apart from a request (such as following a turn for a call, or
standing the voice or terminal service), with its message, stack trace, and
the lines of code around it; performance traces of a share of the requests
they answer, each database query, and each request they make, with the
method, the address and the names of its query parameters, the status, the
browser's or app's user agent, and the query's text; every line they log;
counts and timings; and, each minute, whether the scheduled sweep ran. They do
not send a request's headers or body, the values of local variables, or the IP
address a request came from. Luke's agents send what Sentry's SDK collects by
default, apart from request bodies and what a model is sent or answers: every
error they did not handle or that ended work they started apart from a turn,
with its message, stack trace, the lines of code around it, and the values of
local variables, apart from a tool's refusal the agent was handed back to go
on from, which its agent trace still shows; performance traces of each
request they answer, each database query, and each request they make, with
their headers, addresses, the names of their query parameters, and database
query parameters, and the IP address a request came from; every line they
log; and Sentry's agent traces of each turn, which name the model and each
tool called and say how long each call took, how many tokens it used, and
whether it failed. Neither the agents nor the web functions send Sentry the
instructions or messages sent to a model (the plan, the conversation, what was
said on a call, or what the agents read, such as code, a command's output from
your Mac, or an integration's answer), a model's replies, or a tool call's
arguments or result. The words of an error, a log line, or a local variable
can still quote what an agent was working on, such as the path of a file a
tool could not find. In what the agents send, Sentry replaces a value whose
name looks like a credential (such as `auth`, `token`, `secret`, `password`,
`key`, or `session`) before it leaves, but not a credential written in free
text, such as a key in an error's words. In the address of a request
that the web functions or the agents give on a trace, an error, a breadcrumb,
or a log line, the value of each query parameter and the fragment are replaced,
and so is any part of its path shaped like a credential, such as a long token;
the scheme, the host, the rest of the path, and the parameters' names are sent
as the request carried them. An address written elsewhere, such as in a header
or the words of an error or a log line, is sent as it was written. Terminal
tabs' bytes are not sent. What reaches
Sentry is kept under Sentry's retention, not tied to your account, and is not
erased when you delete your account.

**What earlier versions left on our service.** Earlier versions of Luke
followed your coding agent sessions, kept a notebook, and pushed briefings to
a phone; this version does none of that. On 13 October 2026 we deleted what
they stored on our service: the Conductor key an earlier version synced, the
roster of your Conductor sessions it observed, Luke's workspace files (among
them the things he remembered about you in `USER.md`) with their embeddings,
and the device rows and push tokens an earlier Mac, iOS, or Apple Watch app
registered. What stays in our database, unread, is the conversations Luke kept
for the sessions he followed and for the helpers he delegated to, deleted
with your account. A calendar grant an earlier version kept encrypted on
this Mac stays in its settings file as that version left it, still encrypted:
this version neither reads nor sends it. Every provider key an earlier version
stored on this Mac, a key of your own for voice among them, is removed from
your Mac the next time Luke opens, without being read.

**Feedback.** If you use the feedback form, we receive what you typed, any
screenshots you attached, and — unless you untick "Include my name and email"
— the name and email of the account you are signed in with; they reach us
only when you press Send.

## Who we send it to

- OpenAI, for voice. A voice session is one continuous
  conversation. While your microphone is on — from a press of an agent's Call
  button, the call card's microphone, or the microphone shortcut, or from
  starting a new voice chat, until you press one of those again — everything
  it hears streams to OpenAI. When it goes off, Luke tells OpenAI at once to stop
  listening and closes the microphone when OpenAI confirms, within five
  seconds; Luke can still speak while it is closed. A call opens only when you
  press an agent's Call button or start a new voice chat; starting a task
  never opens one, and Luke takes no key from the machine to open one. Every session goes through our own voice service on your
  account, and runs on the OpenAI API key you saved in Settings › Agents, never
  on a key of ours: without one, calls are off. Nothing on your Mac holds or
  is handed the key. The service creates the session on your key; relays the control and transcript events between your Mac and
  OpenAI; reads them to keep the record and to hand each spoken ask to the
  agent the call speaks into; drops the audio OpenAI reflects back, so neither your voice nor
  Luke's transits our service; keeps only the lines and the call record
  described under "Your account"; logs status and close codes, event names,
  the kind of any failure, and counts, never what was said or an error's own
  words, apart from the reports to Sentry described under "Error, performance,
  and agent reports from our service"; and counts each session's billed seconds once. A line
  you type into an agent's composer while a call is up on that agent goes to the
  call rather than straight to the agent: your Mac hands it to our voice
  service, which keeps it as a typed line in the agent's transcript, hands it to
  the agent, and tells OpenAI's voice session the line, with each mention as its
  name, so the voice speaks the agent's reply; files you attach to it are not
  sent. The agent answers each spoken ask as a turn of its own
  conversation, on the model it runs on, as described under "Anthropic and
  OpenAI, for a coding agent" below; your Mac makes no such call. Every model
  call is counted in your daily usage. A
  development build run from a checkout can write a local trace of the voice
  traffic when its developer asks; a packaged build cannot.
- Anthropic or OpenAI, for web search. A coding agent and its workers search
  the web with the search tool of the provider its model is on (Anthropic's
  for a Claude model, OpenAI's for a GPT one), inside that model call and on
  your own key for that provider. A page an agent reads is fetched by our service itself,
  from a public HTTPS address, with no cookie or credential, so the site sees
  our service's address rather than your Mac's; up to a megabyte is read and
  20,000 characters kept. The query, what the search found, and the page's
  text are stored with the agent's transcript like any other tool call.
- OpenAI, for dictation. Pressing the microphone in a message box records it,
  in memory and never on disk, until you press ✓ or Enter (or for two minutes
  at most); ✕ or Escape discards the recording. It goes through our service,
  on your account, to OpenAI's transcription model on the OpenAI API key you
  saved in Settings › Agents (never a key of ours; without one, dictation is
  off), with words the
  task is likely to contain — its repository's name, its title, and the file
  paths it names — so they are spelled right. Only the text comes back, into
  the box at the caret, and it goes nowhere until you send it. Our service
  stores and logs neither the recording nor the text, apart from the reports to Sentry described under "Error, performance,
  and agent reports from our service", and counts
  only the clip and its length in your daily usage; OpenAI keeps the request and its reply
  under its own retention policy.
- Keyframe Labs, for video calls, only while the Video calls experiment is on
  in Settings › Experimental, which it is not until you turn it on. The
  choice is your account's, so it follows you to every Mac you sign in on.
  Each call that shows Luke on video opens one avatar session at Keyframe: our
  service asks Keyframe for it
  on our key, naming the stock persona Luke appears as (the default, or the
  avatar you chose under Video calls, which is kept on that Mac) and nothing
  about you,
  and hands the session's one-time pass to your Mac, where only Luke's main
  window holds it. That window then sends Keyframe Luke's synthesized voice as
  he speaks, which carries what he says about your plan, and plays back the
  video, in the called agent's tab and on the call card, and the
  audio Keyframe renders from it. While another app is in front, that window
  also hands the video, and nothing else, to Luke's floating call window over
  a connection between the two windows on your Mac. Your microphone never reaches
  Keyframe, nor does anything else on your Mac or in your account: the voice it
  receives is Luke's alone. Our service logs only whether a session started, the
  Keyframe server it opened on, and, when one could not, why, and keeps, with
  the call's record, when each session started and ended, its length, and why it
  ended. Keyframe keeps what it receives under its own retention policy. The
  Avatar menu under Video calls shows each stock avatar's photo, which your
  Mac loads straight from Keyframe's public storage as the menu is drawn, so
  Keyframe sees your Mac's IP address then, as any site serving an image does;
  no referrer and nothing of yours is sent with it.
- PostHog, for usage data and screen recordings from the Mac app, screen
  recordings from Luke in a browser, and the counts our service makes of the
  work done through it. The counts go through our own service; the
  recordings go from Luke, on the Mac or in your browser, to PostHog directly.
- Sentry, for the Mac app's and Luke in a browser's crash and performance
  reports, and our service's and Luke's agents' error, performance, log, and
  agent reports, described above.
- Anthropic, for a pull request's chapters. Pressing Generate chapters in a
  coding agent's Pull request tab sends the pull request's title, description,
  commit messages, and patches, except those of files a reader reads past, to
  the Claude model the member chose in Settings (Haiku 5.5 unless they changed
  it) from our service, on that member's own Anthropic API key (or, with only
  an OpenAI key saved, on an OpenAI model and that key), never ours, in at most two
  calls (the second places the parts of the diff the first left out), as
  described under "A coding agent's pull request". Our service logs only how a
  generation failed, by its kind, and counts its outcome as described under
  "Usage data"; Anthropic keeps the request and its reply under its own
  retention policy.
- Anthropic and OpenAI, for a coding agent. When you, or another coding
  agent, start one on a task, our service runs it in a Vercel Sandbox of its own with the
  task's repository checked out, and calls the model chosen (or your default)
  and whatever model it picks for each worker it hands work to, which may be
  the other provider's: Anthropic for a Claude model, OpenAI for a GPT model,
  on the subscription or API key you added for that provider, never ours; with
  neither, the agent does not start. A call on your own key is billed to you
  by the provider, and if our service can no longer read your key the agent
  stops and asks you to replace it. Fast, for Claude models, runs the same
  calls on Anthropic's fast mode on your own Anthropic key, where Anthropic
  grants that key fast mode. Each call carries the plan's text, the agent's
  conversation so far, any files you attached, and what it read of the
  repository, the web, your integrations, its skills, and your Mac; the
  provider keeps it under its own retention policy. The agent's workers can
  read the checkout, the web, and your integrations, and run commands on your
  Mac, but only the agent edits the checkout. The agent's transcript — its
  words, reasoning summaries, and tool calls with their input (such as the few
  words it gives to describe a command) and output — is written to your
  account's conversation as described under "Your account". Archiving an agent
  stops a running turn and sets the agent aside; its transcript, with your
  files, and its pull request are kept, and you can bring it back. Luke and
  coding agents can archive an idle agent of the workspace too, a teammate's
  included, for the member they act for, and bring one back; neither archives
  one that is still working. The agent records who archived it (you, or Luke
  or the archiving agent's title on your behalf) and any reason given, which
  every member of the workspace sees on the archived agent until it is
  brought back, when the record is cleared. The sandbox
  has ordinary Internet access and runs the repository's own checks; the agent
  searches the web as described above. The sandbox stops when a turn ends or
  you stop it, and its checkout, with the agent's changes, stays in a snapshot
  on the terms under "How agents read your repository". Nothing
  of the sandbox reaches the screen recording. A Terminal tab opens a shell in
  the agent's sandbox, beside its checkout, and reaches it through our
  service: what you type and what the shell prints pass through the service
  on their way and are not stored, logged, or counted there or on your Mac.
  Your shells, and what they printed, stay in the sandbox until it stops, and
  no shell history is written to a file; anything you write into the
  sandbox's files the agent can read on its next turn. While you are typing in
  a terminal the sandbox does not stop at a turn's end; it stops about seven
  minutes after you last typed, unless a turn is running, and a stopped
  sandbox comes back only when you resume it. While a terminal is connected,
  the agent's GitHub access at the sandbox's firewall is kept fresh, so what
  you run there reaches GitHub as the agent does, never holding the token
  itself.
- Anthropic, for titles. As a coding agent's turn completes, until it has a
  title and for its first three turns at most, our service asks a small Claude
  model on your own Anthropic API key (or a small OpenAI model on your OpenAI
  key where you saved only that), never ours, for a short title, sending
  your first message (for an agent started on the plan, the plan's text), your
  latest one, and the agent's latest answer, as text alone cut to 2,000
  characters each. A worker that a coding agent hands work to is
  titled from the whole subagent task it was handed. Each title is stored with the agent or worker; Anthropic keeps the
  request and its reply under its own retention policy.
- GitHub, through the Luke GitHub App, for a coding agent's work. The agent
  checks the repository out and pushes its branch with an installation token
  the App mints for that one repository, set at the sandbox's network
  boundary and never inside it. Where you started the agent, in the app or
  by asking Luke, you signed in with GitHub (or linked it), and your GitHub
  account may push to the repository, the agent writes as you: its commits
  name your GitHub account at the private noreply address GitHub gives it,
  each with Luke's App as co-author, and our service opens its pull request
  as you, with your own GitHub App token, in one request to GitHub for that
  one repository. Your token is used on our service alone and never reaches
  the agent's sandbox, so neither the agent nor anyone with a terminal in it
  holds it; everything else the agent asks of GitHub, such as a comment or
  marking a draft ready, goes out as the App. Where GitHub refuses your
  token, the App opens the pull request in your place and the agent keeps
  why. Otherwise, and always for an agent an automation started, its commits
  and pull request are the App's own, under its bot, and name no one's
  GitHub account. Which of the two an agent writes as is kept with it.
  Where the installation has
  accepted it, the agent also reads its pull request's checks and the logs of
  failed runs with that token, which land in its transcript like any other
  command's output. GitHub also tells our service, signed with a secret it
  shares with us, when a pull request or its checks change on a repository the
  App is installed on; our service reads only the kind of change and the
  repository's and branch's names from that message and keeps none of it,
  then, for up to ten of the newest agents on that branch, reads with a token
  the App mints on the workspace's installation the pull request's number,
  title, link, state, checks,
  and size of change, and the branch's latest commit, and keeps them with the
  agent until the task is deleted. When someone reviews or comments on an
  agent's pull request, or a check fails on an agent's branch, GitHub tells
  our service the same way; our service reads who did it by their GitHub
  login, the pull request's number and branch, the link to the review,
  comment, or failed commit, a review's verdict, when, and what the review
  or comment says; for a review it also reads that review's inline comments
  from GitHub, each with its file and line, with a token the App mints for
  the repository on the workspace's installation. It sends that to the
  agents on that pull request as a message, which their transcript keeps
  under that login until the task is deleted, and which reaches the model
  that runs the agent like any other message. Whatever the message cut
  short, or a failed check, the agent reads itself with the App's token,
  and what it reads lands in its transcript like any other command's
  output. Our service also reads from GitHub, through
  the workspace's installation and storing none of it, a file or folder you
  open, a pull request's changed files for the Changes tab, a repository's
  skills, and the number, title, link, state, and author's GitHub login of a
  pull request or an issue a plan, a reply, or an Inbox item links to, which
  the app shows on the link; an issue is read on a token cut to reading
  issues alone, and an Inbox item's link is read through its own workspace's
  installation, its
  plan's or its agent's, and through none where that is not known.
- Vercel Connect and Linear, if you connect Linear: Vercel Connect keeps
  Linear's token, and our service sends each Linear call, with its input, to
  Linear's MCP server, which keeps it under Linear's own policy.
- Vercel Connect and Notion, if you connect Notion: Vercel Connect keeps
  Notion's token, and our service sends each Notion call, with its input, to
  Notion's MCP server, which keeps it under Notion's own policy.
- Vercel Connect and Sentry, if you connect Sentry: Vercel Connect keeps
  Sentry's token, and our service sends each Sentry call, with its input, to
  Sentry's MCP server, which keeps it under Sentry's own policy.
- Vercel Connect and Slack, if you connect Slack where it is offered: Vercel
  Connect keeps Slack's token, and our service sends each Slack call, with its
  input, to Slack's MCP server, which keeps it under Slack's own policy.
- GitHub's MCP server, if you signed in with GitHub: our service sends each
  GitHub call, with its input and your Luke GitHub App token, to GitHub's MCP
  server, which keeps it under GitHub's own policy.
- Vercel Connect and Executor, if you connect Executor: Vercel Connect keeps
  Executor's token, and our service sends each Executor call, with its input,
  to Executor's MCP server, which keeps it under Executor's own policy and
  passes it on to the app it names.
- Vercel Connect and Granola, Mercury, Neon, PostHog, Supabase, Vercel, or Y
  Combinator, for each you connect: Vercel Connect keeps its token, and our
  service sends each call, with its input, to that service's MCP server,
  which keeps it under that service's own policy.
- Vercel, which runs our service and the sandboxes, and Neon, which hosts our
  database: everything our service keeps is stored with Neon and passes
  through Vercel. Each coding agent and its workers also run as sessions on
  Vercel Workflow, which keeps each
  session's history (the messages, files, tool calls, and answers its model
  works from) so the session can pick up where it stopped. Deleting a task or
  your account asks Vercel Workflow to end each of its sessions for good, a
  turn still running included; a session that could not be reached or did
  not confirm in time is noted in our service's logs and left as it stood,
  and the delete goes on without it, its history kept under Vercel's own
  retention. When a session of Luke's ends, Vercel deletes that history at
  once, though the session's ids, status, and times may stay as long as
  Vercel's own retention. This holds for a session started on or after
  13 October 2026. For now, a coding agent's session keeps its history after
  it ends for our hosting plan's Workflow retention period, so that we can
  find out why a session stopped partway, and Vercel deletes it after that.
  A session of Luke's started before then, and the session of a worker
  either one hands work to, keeps its history under Vercel's own retention.
- Neon, asked directly by Luke on your Mac or in a browser, which sees its
  network address: while you are signed in, Luke follows what waits on you
  across your account, for the Inbox, over Neon's Realtime service, with a
  short-lived query our service seals for your account, and Neon sends back
  the rows of that inbox as they change.
- GitHub, asked by your Mac itself and unauthenticated, which sees your Mac's
  network address: to check for updates, carrying nothing about you, when Luke
  opens, every four hours, and when you ask from Luke's menu or Settings,
  signed in or not, with a newer version downloaded from GitHub and installed
  when you quit; and for the picture of each repository owner the app names,
  an organization's logo or a person's avatar, carrying only the owner's name.
- Google or GitHub, asked by your Mac itself for your own profile picture,
  from the address your sign-in gave us, carrying no referrer, beside your
  name and on your own first workspace while it has no photo.

We do not sell your information or use it for advertising.

## Our website

tryluke.dev counts page views, presses, and sign-in steps using PostHog, and
records the pages themselves, except the sign-in pages, which it does not
record. A press is counted by what was clicked and where, never the words on
it, and a recording masks what you type into a field. Before a count or a
recording leaves your browser, the site takes out of every address in it, on
every page, any sign-in code, state, error, challenge, signature, or token a
sign-in or a link put there, and cuts a sign-in page's address to the page
itself. It collects nothing else, whatever our PostHog project's settings
say: no errors, nothing from your browser's console, no network requests,
no page or network timings, no heatmaps, no chat widget, surveys, or product
tours, and no feature flags. When you finish signing in, on the page that
hands the sign-in back to Luke on your Mac, or on the consent page where one
is shown, the site names you to PostHog by your account's id, name, and
email address, which links your earlier visits to your account, and counts
the sign-in once, remembering in your browser which sign-in it last counted.
The hand-off page is one of the sign-in pages above: not recorded, its
address cut to the page itself. Your browser contacts PostHog directly, so
PostHog sees your network address, as it does for the app's recordings.

Luke in a browser, the app at tryluke.dev/app and at every link to something
in Luke, is not one of the site's pages above: it records and reports what the
Mac app does. It makes screen recordings as described under "Screen
recordings", with every word masked and the same parts left out, and with
the tab's address, which names the workspace and what it opens, and the
address of the page that sent you there, replaced by the app's own; only the
site's production deployment records, never a preview of it. A recording
follows your account in that browser: signing out files what follows under
nobody, and deleting your account in one tab stops the recording in every
tab of that browser until you sign in again. It sends Sentry reports of the
errors it did not handle and of a tab that could not draw, and performance
traces for about one page load in ten, and a warning for each kind of request
the page's security policy refused, once in each tab, naming only the
policy's directive and the refused address's origin, or the browser's own
word for it, such as inline, all using Sentry's default data
collection, as described under "Crash and performance reports from the Mac
app", where the page's address, your browser's details, and the addresses of
the requests it made take the place of the Mac's. Your browser contacts
PostHog, Sentry, and Neon (see "Who we send it to") directly, so each sees
your network address.

A link to something in Luke, pasted into Slack, iMessage, or anywhere else
that previews links, shows only Luke's own card: the Luke name and logo, the
same for every link, and nothing of the task, the agent, the person, or the
workspace it opens.

## Storage

Your settings and your account's sign-in tokens stay on your Mac, the tokens
encrypted under a key held in the macOS Keychain, beside whatever settings,
keys, or calendar grants an earlier version kept there, which stay as they
were but for a voice key, removed as described above. Nothing of your
conversations with agents or their working memory is kept on your Mac
beyond the layout of its window described under "On your Mac", and the
switch for commands on your Mac and each repository's run command for Run
are kept with that Mac's settings. Luke in a browser keeps your settings in
that browser's own storage for the site, and no sign-in token at all: it is
signed in by the site's session cookie, which only the browser holds. Its
screen recording keeps, in that browser's storage for the site, the
anonymous id it records under, the account id it files under once you sign
in, and whether it may send, under `luke_app_replay` and
`luke_app_replay_consent`, apart from the site's own counting. A connect
started there, such as connecting GitHub, keeps in its tab's session storage a
random id naming the connect, or the address it left from, until the page it
lands on, or the app opened again in that tab, lets go of it. Our service
keeps your account and, unsealed, your conversation in our database, which
Neon hosts, beside what earlier versions left there; a
task's checkout and a coding agent's changes are held in a Vercel Sandbox and
its snapshot; usage counts and recordings are held by PostHog, and crash
and error, performance, and agent reports by Sentry.

## Your choices

- Sign out of your Luke account to turn voice off.
- Turn off Settings › Account › "Share usage data" to stop Luke sending the
  usage counts it makes (see "Usage data"); what is waiting to be sent is
  dropped, and nothing more is sent until you turn it on again. It is set on
  each Mac, and in each browser, apart. It is on by default in the Luke you
  download, and off in a Luke you build and run from its source, which sends
  no usage counts unless you turn it on. It does not stop the counts our
  service makes of the work done through it.
- Turn off Settings › This Mac › "Let agents run commands on this Mac" to stop
  coding agents running commands on that Mac; it is set on each Mac apart, and
  signing out stops it too.
- Switch an integration off for one coding agent in its message box's MCP
  menu, or disconnect it for every agent in Settings › Integrations.
- Delete any workspace file an earlier version of Luke left on your Mac;
  nothing reads it now. What earlier versions left on our service goes with
  your account.
- What you say on a call goes to the conversation of the agent you called,
  fixed when the call opens and never moved afterwards.
- Luke listens through your microphone only while a call's microphone is on,
  or while a dictation into a message box is recording, which the box shows as
  a moving waveform with its time. An agent's Call button, the call card's
  microphone, or the microphone shortcut opens it until you press one again,
  and so does starting a new voice chat, which opens a call into its agent.
  macOS's microphone
  indicator is lit whenever the device is open: from the press, including
  while a new call connects, until OpenAI confirms it has stopped listening,
  within five seconds of the microphone going off. Escape closes it too, and
  also tells Luke to stop talking.
- Delete your account from the Account section in Settings. This erases at
  once your account and everything our service keeps under it — among them
  your sign-in records and the GitHub and Google tokens we kept, your usage
  counts, preferences, and plan template with its history, your pinned
  repositories, your tasks with their history, whiteboards, pages, coding
  agents, inbox items and pictures, and chat messages, the conversation with
  its attached files, every call's record, the commands waiting for your Mac with the
  record of when it last read, your own API keys, your name on the memories
  Luke's agents kept in your words (the memories themselves stay with their
  workspace), Luke's record of your
  Linear, Notion, Sentry, and Slack connections, and everything earlier
  versions left there — and asks PostHog to erase the person it holds for your
  account with its usage data and recordings, which PostHog queues and carries
  out shortly after rather than at once, and which does not reach a recording
  never attached to your account. If PostHog cannot be reached, refuses, or
  reports that it could not erase them, the account is deleted anyway and
  PostHog keeps what it holds.
  Luke stops recording for the rest of the session, and starts again the next
  time you open it or sign in. Sentry reporting continues, and what Sentry
  already received is not tied to your account and is not erased with it. Deleting does not affect your Google or GitHub account
  or the account at any service you connected, and does not revoke the Luke
  GitHub App (revoke it in GitHub's settings). It asks Vercel Connect to
  revoke every integration's grant it holds; if Vercel Connect cannot
  be reached, the account is deleted anyway and a grant stays until you revoke
  Luke in that service's own settings. It asks Vercel Workflow to end every
  session of yours, noting in our logs any it could not, and, shortly after,
  deletes their sandboxes with the snapshots no other sandbox uses; the
  session history Vercel Workflow keeps goes as described under "Who we send
  it to", and anything stored only on
  your Mac stays there until you remove it.

## Google user data

Luke's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. We use what Google returns when you
sign in with it, your name, email address, and profile picture, only to
identify your account. It is not transferred, sold, or used for advertising.

## Contact

Email founders@stagereview.app with any questions about this policy.
