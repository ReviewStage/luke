# Privacy

Last updated: 16 October 2026

Luke is a macOS app for planning a feature by voice. This policy explains
what we collect, who we send it to, and how to turn it off.

## What we collect

**On your Mac.** Luke and coding agents can run any shell command on your
Mac without asking you, and what it prints leaves your Mac (see "Commands
agents run on your Mac"). Apart from that, nothing in Luke reads a coding
agent session, message history, file contents, or command output from your
Mac's disk or from any other app, except a file you hand it to attach to a
coding agent's message (see "Files you attach to a coding agent"). The only
coding agents it lists are the ones started on a task from Luke — its Start
button, New coding agent, or Luke on a call — which our service runs
in sandboxes of their own (see "Who we send it to"), and the transcripts it
shows, a coding agent's and the task conversation's, are read from our
service. Luke reads a task's repository in a sandbox on our
service. No part of Luke's judgment runs on this Mac, so no transcript,
working memory, or inbox of his is held here on disk, and in memory only the
tabs described next. On disk, under its application data, Luke keeps only
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

**Commands agents run on your Mac.** Luke, the workers he
hands work to, every coding agent, and the workers a coding agent hands work
to can each run any shell command on your Mac, at once and without asking you,
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
and its error are returned to the agent; stored with the task conversation
or the coding agent's transcript, under its terms, and in the session history
described under "Who we send it to"; shown, marked "On your Mac", on the
task's Call tab, a worker's tab, or the agent's tab on every Mac signed in as
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

**Your conversation with Luke.** Nothing on your Mac writes what you said or
what Luke spoke to disk, and no record of what he did is kept there. While a
task is open, Luke on your Mac reads from our service, for the task's Call
tab, the spoken words of the task's calls beside Luke's turns:
what it wrote, the summary of its reasoning that OpenAI returns for each step,
and each tool call's input and answer, such as a command's output from the
task's repository or from your Mac, or a public page's text. There each turn
keeps its newest sixty parts with every piece of text cut to 4,000
characters, and a page's HTML and a picture of the whiteboard are left out;
each worker Luke handed work to shows only its title, model,
and where it stands. Opening a worker reads its whole session, uncut, for its
own tab, and opening a coding agent, yours or another member's, reads its
transcript (its words, reasoning
summaries, and tool calls with their input and output) for its tab, as it
runs. Our service keeps Luke's turns with the task's
conversation and Luke reads them while the task is open, during a call within
a moment of each step, the newest twenty first and older ones as you scroll.
All of this is held in Luke's memory, never on disk, goes when you leave the
task or quit Luke, and is left out of the screen recording (see "Screen
recordings"); those turns are never sent to Luke's voice window or his
call window, which draw none of them. Your default model, effort, and
context size for a coding agent are kept with your account preferences on our
service, set in Settings › Coding agents or by the model you last started
with. The Claude model your Generate chapters runs on is kept with them too,
set in Settings › Coding agents. Where a Luke link you open in a browser goes, staying there or handed
to Luke for Mac, is kept with them too, set in Settings › Account; Luke in a
browser on a Mac reads it each time it loads a link that names something in
Luke.

A voice session on this Mac is a call about one task. It opens with nothing
of your coding agents and no line of your conversation; what Luke knows when
he answers a spoken ask he reads on our service, from the plan and the record
described under "Your account". During the call, Luke can
list the coding agents of the task's workspace, on any task and whichever
member started them, read the last few turns of one's transcript, send one a
message it writes for you (kept in that agent's transcript as Luke's), and
start a new one on the task; what he read and sent is kept with the task's
conversation. A fixture or evidence run keeps no conversation at all.

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
task or another task of the workspace, without asking you first; a
message is kept in the receiving agent's transcript under the sending
agent's title, opening with the sending agent's title and id, and goes to
the receiving agent's model provider as the rest of its conversation does,
and an agent it starts runs as the member who started it, on that member's
keys, and is told which agent started it. It stores
under your account its name and its plan, one Markdown document, which begins as a copy of
your plan template and is written by the call's notetaker, by coding
agents started on it, and by you, when you edit a section or restore an
earlier version. Your edits are sent as you pause typing and when you finish;
unsaved words stay in Luke's memory on your Mac, never on disk. Our service
keeps the plan's history without limit: the document after each revision
(saves one writer makes close together count as one), who wrote it (you or
another member, editing or restoring which version, kept as that member's
account; the notetaker, on which member's call; or which coding agent) and
when, and who last changed each section and when, so Luke can say so beside
it, naming each member by their account's name to every member of the
workspace. A revision of a member whose account is deleted keeps no account
and names nobody. A coding agent's last fifty saves are also kept as its
notes, so Luke can tell you what it changed. All of it is stored as written,
bound to your account and readable by our own operators, like the
conversation described below. Luke on your Mac remembers, for each task, only
the time of its newest save when you last had it open, to show which sections
changed since.

Deleting a task removes it at once with its history, its inbox, and the
record of each coding agent started on it with the plan copy or prompt that
agent was handed, and marks the task's conversation and each agent's
transcript deleted, removed thirty days later. Before it deletes anything, it
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
Luke and the coding agents read the plan with each picture's line, its
address, its alt text, and its caption, but not the picture. Luke, or a
coding agent on the task, may look at one of the plan's pictures when those
words are not enough, read as the member the turn runs
for, which sends the picture to the model that looked; our service keeps
only that it looked in the task conversation or the agent's transcript, not
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
reply, edit, resolve, and reopen, and of every comment Luke or a coding agent
on the task writes, naming the member whose turn it ran on. Every member of
the workspace sees every comment, as they see the plan. Comments are stored
as written and readable by our own operators, like the plan. Deleting a
comment or a thread deletes it at once; deleting the task deletes all of its
comments; deleting your account leaves the comments you wrote on a task that
stays, naming nobody, as it leaves the words you wrote. Luke's planning model and the task's coding agents read the
open threads beside the plan, and a thread in which a member mentions one of
them with @ is handed to it whole as a request; either way the comments' words
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
up to 300 characters: our service reads the file from the sandbox, keeps the
image, up to 1.5 MB, in our database beside the item, and serves it only to
Luke signed in as you. Items and their pictures are stored under your account
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
coding agents, each plan's Luke, and the people in it talk: a general
channel, a channel for each plan, channels a member opens on a topic, and
direct messages between two members, with replies in threads. Each member
has a handle our service makes once and keeps: yours is spelled from your
account's name. A message is stored with its words, any links, references to
lines of a repository (a path, the lines, and the commit, never the lines
themselves), the members it mentions, who posted it, where, and when; it may
also ask for an answer, with the answer and who gave it stored beside it. A
message may carry a picture an agent took in its sandbox, which our service
reads from the sandbox and keeps beside the message, up to 1.5 MB. Every
message is stored under the workspace and readable by our own
operators, like an agent's transcript. Every person in the workspace can
read every channel and every direct message, one between two other people
included; a coding agent and Luke read the channels and only their own
direct messages, and only a direct message's two members post in it.
Luke's planning model posts as its plan's Luke where you ask it to, and at
the start of each of its turns reads what was said in the chat since it last
read, up to 20 messages, sent to the model provider with the rest of the
turn.
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
later call, copies images and PDFs into the agent's sandbox, and keeps them in
the agent's transcript, stored as sent and readable by our own operators,
except that the prompt an agent is started on keeps an image or PDF by name
alone. They go when the transcript does; the sandbox's snapshot and the
agent's session history keep them on the terms under "Who we send it to".

**Pictures in a tool's answer.** When a tool answers Luke or a coding agent
with a picture, as a connected service can answer a screenshot or an image
attached to an issue, the model that made the call sees it, and our service
keeps the picture once, a PNG, JPEG, or WebP of up to 4 MB, in our database
beside the task's conversation or the agent's transcript the call is written
to, which names the picture by an id rather than carrying it; a conversation
or transcript keeps up to 200 MB of pictures. A larger picture, one past
that, or one of another kind is not kept, and the record says only its kind
and size. A coding agent or one of its workers can also show you pictures
from its sandbox, such as screenshots of a page it changed, up to twenty at a
time with a line of its own words each: our service reads each file from the
sandbox and keeps it the same way, beside the agent's transcript or the
worker's, and the model is told only that they were shown, never handed the
pictures back. A coding agent's kept pictures, and its workers', are served only
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
finds that changed. Only coding agents' and their workers' model calls use it;
Luke's judgment, voice, notetaker, dictation, titles, every web search,
and Fast always run on our keys, and an account with its own Anthropic key is
not offered Fast. After you save it, neither your Mac nor any answer from our
service holds the key again, and we never log it or send it to our analytics,
crash reports, or screen recordings. Removing it in Settings, or deleting your
account, deletes it.

**A task's whiteboard.** You and Luke can both draw on a
task's whiteboard. Our service stores it with the task, as drawn and readable
by our own operators: every shape, arrow, line, stroke, and piece of text and
where it stands, and Luke's latest drawing. Luke on your Mac
sends the whole board each time it changes and, with a save holding a new
drawing of the model's or one the model is waiting to look at, a picture of
the board as your Mac draws it, at most 1,200 pixels a side, kept in place of
the last one. The model reads the board as text at the start of each turn and
may look at that picture to check what it drew, which sends the picture to
the model; our service does not copy it into the task conversation,
though the model's session history may keep it (see "Who we send it to").
Each drawing call, with what it drew, is stored in the task conversation.
You cannot put an image or a file on the board. Deleting the task deletes its
whiteboard.

**How Luke reads your repository.** A task names a GitHub
repository of the Luke GitHub App installation connected to the task's
workspace. Luke
reads its code by running shell commands (such as `ls`,
`grep`, or `cat`) in a Vercel Sandbox: an isolated machine our service opens
for the task's conversation, on Vercel's infrastructure, never on
your Mac. The first command checks out the default branch's latest commit,
after our service confirms the workspace's installation still reaches the
repository, with a read-only
token the App mints for that one repository, good for an hour. The token is
set at the sandbox's network firewall for the checkout and withdrawn when it
ends: it never enters the sandbox, a command, its output, or the
conversation's record. The sandbox has ordinary Internet access while a
command runs. Each command, the few words the model gives to describe it, and
up to 20,000 characters each of its output and error text are stored with the
task conversation, under its terms. The checkout stays in the sandbox
between commands and, once the sandbox is stopped for idleness, in a snapshot
Vercel keeps until thirty days after its last use. When the task's
conversation is removed, thirty days after you delete the task, our service
deletes the sandbox of each of its sessions and of its coding agents', with
the snapshots no other sandbox uses, shortly after; deleting your account
does the same for every session of yours, shortly after the deletion. A
session a task's conversation was moved off earlier in its life is not
tracked, and its snapshot stays until Vercel lets it expire. Nothing written
in the sandbox reaches your repository.

**Code on screen during a call.** When Luke wants to
show you code, it names a file and lines, and our service reads them from
the same sandbox checkout. The path, the commit the checkout read it at, the
line numbers, the lines (at most 200, each cut to 400 characters), and the
model's note on why it showed them (at most 280 characters) are stored with
the task conversation and sent to your Mac, which draws them in the task's
Code tab; nothing is read from
your Mac's disk. The service refuses a path outside the checkout and never
reads a file named `.env` or starting with `.env`. The voice model is told
the path and line numbers on screen, so Luke can refer to them. When you open
the task, Luke on your Mac reads back all the code shown on it, by the same
rules, and holds it in memory, never on disk, until you leave the task or quit
Luke. It is never part of the task's plan.

**A whole file opened from a snippet.** A snippet in the Code tab can open
its whole file in a File tab. Our service reads the file from GitHub at the
commit Luke's checkout read it at, or, for a file you open from the tree, a
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
When a task conversation or a coding agent's session starts, our service
reads them from GitHub at the head of the default branch, with a token for
that one repository: up to 64 skills, leaving out a file over 64 KB. Luke
and the coding agent are told each skill's name and
description, and read a skill's whole file when they load one, which you can
ask for by typing `/` and its name in a coding agent's message box; a load is
stored with the task conversation or the agent's transcript like any tool
call. Luke on your Mac reads each skill's name, description, and path through
our service, read from GitHub the same way, never its file, to list after `/`,
and holds them in memory only; a skill named in a message opens its file in a
File tab, by the rules above. Our service keeps no copy of the skills
themselves.

**Pages an agent makes.** Luke and coding agents can make a
page for a task: an interactive HTML document, such as a chart or a mockup,
that opens in the task's side panel. Our service stores each page with the
task, as written and readable by our own operators: its title and HTML, at
most 262,144 characters a version, and every version it has had, each kept as
written and never changed, with which coding agent, or Luke, showed it.
Deleting the task deletes its pages. A page made by Luke is part of the task
conversation, so it is sent back to Luke's model as the conversation goes on
(see "Who we send it to"). Luke
and coding agents can also read a page of any task of the workspace by its
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

**Luke's working memory.** Luke's judgment, like each coding agent, works
from a session history of its own turns — the model's record of what it read,
said, and did, folded into a written summary when it grows long — kept by
Vercel Workflow for our service on the terms under "Who we send it to"; our
database keeps the record of each turn described under "Your account", from
which a new session picks up. None of it is held on your Mac, in memory or on
disk.

Earlier versions kept the conversation, his working memory, the things he
remembered about you, and a search index over his workspace files in a
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

**How the plan is written during a call.** A notetaker on our
service, not Luke's judgment, writes the plan during a call. Once
you have been quiet for about a second, it makes one call to OpenAI
(`gpt-5.6-luna`) on our key, carrying the saved plan, both sides of what was
said since its last note with a few lines before them, and Luke's own
replies, and applies the notes that call answers: a point added under a
heading (adding the heading where the plan lacks it, and taking the place of
the template's guidance where that is all the section holds), a phrase
replaced, or the lines a phrase names removed, drawing each on your Mac as it
is written. It is told which sections you last wrote,
so it adds to your words rather than rewording them, and so is
Luke. It runs only during a call you started and only for its
task, each run counts in your daily usage, and a failed run writes nothing.
Nothing it reads or answers is kept beyond the plan and its history, said
aloud, or shown elsewhere; OpenAI keeps the request and its reply under its
own retention policy.

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
number a day: one for each voice session you opened; each model call made on
our keys by Luke, the workers he hands work to, a coding
agent, or a coding agent's workers (a call on your own key is not counted);
each title; each web search; each notetaker run; and each clip you dictated;
beside it, how many seconds you dictated.

Luke's own maintainers can see your name, email address, profile picture,
sign-in method, whether you are an administrator, when you joined and were
last active, and your daily counts, and the names of your workspaces and
their members, roles, invitations, connected integrations, GitHub
installation, and activity counts, on an admin page of our site that only an
account we have marked as an administrator can open. Beside them it shows
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

The service also keeps your conversation with Luke. Each turn he runs for you
writes to our database your ask as given; his reply, the summaries of his
reasoning, and each tool call with its input and result; and the turn's model
and effort, token counts, and when it was queued, started, and ended, and how
(rows from earlier versions may also hold the ids of OpenAI's responses). On a
call, what you said is kept as your line and what his voice said as his — an
answer he gave without a turn, what he said around one, a reply he read aloud
— each written once it has settled, so the record holds the words you heard
beside the turns he ran. Each call also keeps a record of its own: its task,
OpenAI's id for the session, when it started and ended and why, its voice
model, its billed seconds (or our own count where OpenAI gave none), and each
line said on it, by whom and when; the task's Call tab shows it. These rows
are not sealed: they are stored as written, and our own operators can read
them. They stand until you delete your account, which removes them at once. A
deleted task's conversation and its agents' transcripts are marked deleted and
removed thirty days later; its call records, with the lines said on them, are
deleted with the task, or within a minute or so of the call ending for a call
still open.

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
connected, Luke and the workers he hands work to can read and
change whatever your Linear account can, through Linear's own MCP server,
without asking you first, and so can every coding agent and its workers,
unless you switch Linear off for that agent in its message box's MCP menu,
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
with its input and everything Linear answered, is written to the task's conversation
or the agent's transcript like any other tool call. Disconnecting stops Luke
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
plan, is shown to the planning model on every turn of its call, and is
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
connection. While you are connected, Luke, his workers, and
every coding agent and its workers, as for Linear, can read, create, and
change whatever your Notion account can, through Notion's own MCP server,
without asking you first. What
Notion answers goes to the model that made the call, and each call, with its
input and everything Notion answered, is written to the task's conversation or
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
its write access there to keep Luke to reading. Our service handles the token
as it does Linear's, and keeps the same record of your connection. While you
are connected, Luke, his workers, and every coding agent and
its workers, as for Linear, can do whatever your Sentry grant allows, through
Sentry's own MCP server, without asking you first. What Sentry answers, which
can include the error messages, stack traces, and event data your applications
sent it, goes to the model that made the call, and each call, with its input
and everything Sentry answered, is written to the task's conversation or the
agent's transcript like any other tool call. Disconnecting and deleting your
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
call, with its input and everything Slack answered, is written to the task's
conversation or the agent's transcript like any other tool call.
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
input and everything the service answered, is written to the task's
conversation or the agent's transcript like any other tool call.
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
its input and everything Executor answered, is written to the task's
conversation or the agent's transcript like any other tool call. Disconnecting
and deleting your account work as they do for Linear: Luke stops using it from
each agent's next step, removes the connection's record, and asks Vercel
Connect to revoke the grant; what agents already changed through Executor, and
the record of it, stays, and a grant Vercel Connect could not revoke stays
until you revoke it in Executor's own settings.

**GitHub, if you signed in with GitHub.** GitHub needs no connecting of its
own: while your GitHub sign-in stands, Luke, his workers, and
every coding agent and its workers, as for Linear, can do whatever the Luke
GitHub App's token allows, through GitHub's own MCP server
(`api.githubcopilot.com`), without asking you first: read and change
repositories, files, branches, issues, pull requests and their reviews,
discussions, and Actions runs where the App is installed and you have access.
Our service reads that token from where your sign-in left it, as it does for
everything else it reads from GitHub, sends it only to GitHub's MCP server,
never to your Mac, a model, or a sandbox, and keeps no other record of the
connection. What GitHub answers goes to the model that made the call, and each
call, with its input and everything GitHub answered, is written to the task's
conversation or the agent's transcript like any other tool call. An account
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
service recorded it.

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
caption of what you or Luke said, your name and email address, and anything
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
the still of its page drawn while something covers it; code drawn in a
transcript; the API keys and Plan template pages of Settings; an automation's
webhook secret, the one time it is shown; and the cards
that open over a row or a chip on hover, a page's preview among them. The
whiteboard and a Terminal tab's shell draw their words as pixels, which the
masking cannot reach, so leaving them out is
their only line, and recording what a canvas draws is switched off. A mention drawn as a chip carries what it names, such as a
plan section's heading, only in its words, never in an attribute the masking
leaves, so the recording keeps its shape alone. Luke does not report what you
clicked. Each recording carries Luke's version and whether it is a released
build or a development one; only a released build records at all.

**Browser tabs.** With the Browser tab experiment on, a Browser tab opens a
web page you choose, your own `localhost` included, in a view of its own on
your Mac. Luke does not see, store, log, or count the page, its address, or
its title; they reach only the panel that opened the tab, and none of it
reaches a trace, a counted event, or our service. The screen recording cannot
see into the page's view, and leaves out the still of the page Luke draws while
a menu covers it; the tab's title and address appear there as blocks, as every
word does. The pages keep their own cookies and storage on your
Mac, apart from Luke's own sign-in, and a sign-in to a site holds across
launches. Every permission a page asks for, such as the camera, microphone, or
location, is refused, and downloads are cancelled.

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
default: every error they did not handle or that ended work they started
apart from a turn, with its message, stack trace, the lines of code around it,
and the values of local variables, apart from a tool's refusal the agent was
handed back to go on from, which its agent trace still shows; performance
traces of each request they answer, each database query, and each request they
make, with their headers, bodies, addresses, the names of their query
parameters, and database query parameters,
and the IP address a request came from; every line they log; and Sentry's
agent traces of each turn: the instructions and messages sent to the model
(which include the plan, the conversation, what was said on a call, and what
Luke and his workers read, such as code, a command's output from your Mac, and
an integration's answer), the model's replies, and each tool call with its
arguments and result. In what the agents send, Sentry replaces a value whose
name looks like a credential (such as `auth`, `token`, `secret`, `password`,
`key`, or `session`) before it leaves, but not a credential written in free
text, such as a key pasted into a conversation. In the address of a request
that the web functions or the agents give on a trace, an error, a breadcrumb,
or a log line, the value of each query parameter and the fragment are replaced,
and so is any part of its path shaped like a credential, such as a long token;
the scheme, the host, the rest of the path, and the parameters' names are sent
as the request carried them. An address written elsewhere, such as in a header,
the words of an error or a log line, a tool call, or a message to the model, is
sent as it was written. Terminal
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
with your account. A key or a calendar
grant an earlier version kept encrypted on this Mac stays in its settings
file as that version left it, still encrypted: this version neither reads nor
sends it. A key of your own an earlier version stored for voice is removed
from your Mac the next time Luke opens, without being read.

**Feedback.** If you use the feedback form, we receive what you typed, any
screenshots you attached, and — unless you untick "Include my name and email"
— the name and email of the account you are signed in with; they reach us
only when you press Send.

## Who we send it to

- OpenAI, for voice and for Luke's judgment. A voice session is one continuous
  conversation. While your microphone is on — while you hold the talk key, or
  from a press of a task's microphone button, the call card's, or the
  microphone shortcut, or from starting a new task, until you press one of
  those again or press and let go of the talk key — everything it hears
  streams to OpenAI. When it goes off, Luke tells OpenAI at once to stop
  listening and closes the microphone when OpenAI confirms, within five
  seconds; Luke can still speak while it is closed. Every ask is spoken; there
  is no way to type to Luke. A call opens only when you press the talk key or
  a task's microphone, or start a new task, which opens a call about it with
  the microphone on where macOS already lets Luke use the microphone and no
  other call is open. Every session goes through our own voice service on your
  account: nothing on your Mac holds or is handed an OpenAI credential, and it
  never reaches OpenAI on a key of your own. The service creates the session
  on our key; relays the control and transcript events between your Mac and
  OpenAI; reads them to keep the record and to hand each spoken ask to Luke's
  judgment; drops the audio OpenAI reflects back, so neither your voice nor
  Luke's transits our service; keeps only the lines and the call record
  described under "Your account"; logs status and close codes, event names,
  the kind of any failure, and counts, never what was said or an error's own
  words, apart from the reports to Sentry described under "Error, performance,
  and agent reports from our service"; and counts each session's billed seconds once. Luke's judgment is a
  separate run of calls to OpenAI's Responses API, one for each step of a
  turn, made from our service on our key when you ask him something on a call,
  carrying the task conversation's working memory: the saved plan, the
  conversation so far, and what Luke and his workers read for
  it, such as the repository's code, a command's output from your Mac, an
  integration's answer, a skill, or a web page. Your Mac makes no such call.
  Our service logs none of the request or the reply and keeps only the record
  described under "Your account", apart from the reports to Sentry described under "Error, performance,
  and agent reports from our service"; OpenAI keeps them under its own retention
  policy. Every model call and notetaker run is counted in your daily usage. A
  development build run from a checkout can write a local trace of the voice
  traffic when its developer asks; a packaged build cannot.
- OpenAI, for web search. Luke, his workers, every coding
  agent, and its workers search the web through our service, which sends
  OpenAI's search the query alone (one line of at most 200 characters; a query
  that looks like a credential is refused) on our key, whatever model or key
  the agent runs on, and asks OpenAI not to store it; each search is counted
  in your daily usage. A page an agent reads is fetched by our service itself,
  from a public HTTPS address, with no cookie or credential, so the site sees
  our service's address rather than your Mac's; up to a megabyte is read and
  20,000 characters kept. The query, what the search found, and the page's
  text are stored with the task's conversation or the agent's transcript like
  any other tool call.
- OpenAI, for dictation. Pressing the microphone in a message box records it,
  in memory and never on disk, until you press ✓ or Enter (or for two minutes
  at most); ✕ or Escape discards the recording. It goes through our service,
  on your account, to OpenAI's transcription model on our key, with words the
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
  video, at the top of the plan's Call tab and on the call card, and the
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
  it) from our service, on our key and outside their usage, in at most two
  calls (the second places the parts of the diff the first left out), as
  described under "A coding agent's pull request". Our service logs only how a
  generation failed, by its kind, and counts its outcome as described under
  "Usage data"; Anthropic keeps the request and its reply under its own
  retention policy.
- Anthropic and OpenAI, for a coding agent. When you, or Luke on a call, start
  one on a task, our service runs it in a Vercel Sandbox of its own with the
  task's repository checked out, and calls the model chosen (or your default)
  and whatever model it picks for each worker it hands work to, which may be
  the other provider's: Anthropic for a Claude model, OpenAI for a GPT model,
  on your own key for that provider if you added one, and otherwise on ours. A
  call on your own key is billed to you by the provider, and if our service
  can no longer read your key the agent stops and asks you to replace it
  rather than switching to ours. Fast, offered for Claude models only to an
  account without its own Anthropic key, runs the same calls on Anthropic's
  fast mode, always on our key. Each call carries the plan's text, the agent's
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
  on the terms under "How Luke reads your repository". Nothing
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
  model, on our key whatever key the agent runs on, for a short title, sending
  your first message (for an agent started on the plan, the plan's text), your
  latest one, and the agent's latest answer, as text alone cut to 2,000
  characters each. A worker that a coding agent or Luke hands work to is
  titled from the whole subagent task it was handed. Each title is counted
  in your daily usage and stored with the agent or worker; Anthropic keeps the
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
  through Vercel. Luke, his workers, and each coding agent
  and its workers also run as sessions on Vercel Workflow, which keeps each
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
conversation with Luke, his working memory, or his workspace is kept on your
Mac beyond the layout of its window described under "On your Mac", and the
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
- Turn off Settings › This Mac › "Let agents run commands on this Mac" to stop
  Luke and coding agents running commands on that Mac; it is set on each Mac
  apart, and signing out stops it too.
- Switch an integration off for one coding agent in its message box's MCP
  menu, or disconnect it for every agent in Settings › Integrations.
- Delete any workspace file an earlier version of Luke left on your Mac;
  nothing reads it now. What earlier versions left on our service goes with
  your account.
- What you say to Luke on a call goes to that task's conversation, fixed when
  the call opens and never moved afterwards.
- Luke listens through your microphone only while a call's microphone is on,
  or while a dictation into a message box is recording, which the box shows as
  a moving waveform with its time. The talk key opens it while held; a task's
  microphone button, the call card's, or the microphone shortcut opens it
  until you press one again or press and let go of the talk key, and so does
  starting a new task, which opens a call about it. macOS's microphone
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
  counts, preferences, and plan template with its history, your pinned
  repositories, your tasks with their history, whiteboards, pages, coding
  agents, inbox items and pictures, and chat messages, the conversation with
  its attached files, every call's record, the commands waiting for your Mac with the
  record of when it last read, your own API keys, Luke's record of your
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
