A ticket list that lives where the work does: a dialog per project,
grouped by status, with every ticket one right-click away from an agent.

## What you get

- A dialog, opened with `Cmd+Shift+K`, from the composer,
  or from the command palette. It opens on the project you are in, or on the
  project list when there is none.
- A flat list grouped into **To Do**, **In Progress**, and **Done**. Groups
  collapse, and a search field filters title and description.
- Tickets are three fields: title, description, status. Descriptions render as
  Markdown and open in read mode; **Edit** switches to writing.
- `+ New` or `N` opens an inline row — type a title, press Enter, type the next.
  The composer's ticket button turns the current draft into a ticket: first line
  the title, the rest the description.
- A ticket can hold sub-tasks, one level deep: a progress bar, a checklist in
  the detail, and a `2/5` chip in the list. Sending a ticket hands the agent
  its open sub-tasks too.
- Click selects, double-click opens, Shift-click takes a range and Cmd-click
  picks one at a time. Arrow keys move, `Cmd+A` takes everything, `Esc` clears.
- **Send to Agent** on one ticket or a whole selection: one new thread for the
  batch, one thread per ticket, or straight into the thread you are reading.
  The ticket moves to In Progress, shows a spinner while the agent works, and
  its badge opens that thread.
- A footer chip lists the threads a ticket is tied to: created in, sent to, or
  mentioned in the description. Clicking one opens it.
- A **Queue** across all projects: mark To Do and In Progress tickets, reorder
  them, and keep one **Now** with the rest **Next**. It leaves the queue when
  the ticket is done.
- The back arrow opens **All projects** inside the dialog: every project with
  its counts, plus a 14-day panel of what got done with a Markdown export.
  Picking a project opens its board; the dialog still opens on the project
  you are in.
- Archive, unarchive, and delete, from the row menu or the detail footer.

## How it works

Tickets live in the plugin's own SQLite database, keyed by project. Sending one
spawns a BB thread — in the project checkout on your current branch by default,
or in a managed worktree when the window's `...` menu says so, remembered per
project. Thread lifecycle events move the ticket: active makes it In Progress,
idle marks it Done.

## For agents

`bb tickets` covers the list: `list`, `show`, `current`, `create`, `update`,
`status`, `archive`, `unarchive`, `delete`, and `send`. Every command takes
`--json`, and a ticket reference can be a short id prefix. `create` inside a
thread links it to the ticket. `bb tickets current` reads the tickets handed to
the running thread, so a worker can read its own
assignment and close it with `bb tickets status <id> done`.
