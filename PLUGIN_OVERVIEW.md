A ticket list that lives where the work does: a floating window per project,
grouped by status, with every ticket one right-click away from an agent.

## What you get

- A narrow floating window, opened with `Cmd+Shift+K`, from the thread header,
  or from the command palette. It belongs to a project, so a projectless screen
  never shows it.
- A flat list grouped into **To Do**, **In Progress**, and **Done**. Groups
  collapse, and a search field filters title and description.
- Tickets are three fields: title, description, status. Descriptions render as
  Markdown and open in read mode; **Edit** switches to writing.
- `+ New` or `N` opens an inline row — type a title, press Enter, type the next.
  The composer's ticket button turns the current draft into a ticket: first line
  the title, the rest the description.
- Click selects, double-click opens, Shift-click takes a range and Cmd-click
  picks one at a time. Arrow keys move, `Cmd+A` takes everything, `Esc` clears.
- **Send to Agent** on one ticket or a whole selection: one new thread for the
  batch, one thread per ticket, or straight into the thread you are reading.
  The ticket moves to In Progress, shows a spinner while the agent works, and
  its badge opens that thread.
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
`--json`, and a ticket reference can be a short id prefix. `bb tickets current`
reads the tickets handed to the running thread, so a worker can read its own
assignment and close it with `bb tickets status <id> done`.
