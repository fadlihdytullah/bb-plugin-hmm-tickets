# Hmm Tickets

A small ticket list that lives where the work does: a dialog per
project, grouped by status, with every ticket one right-click away from an
agent.

## Install

```
bb plugin install path:/path/to/bb-plugin-hmm-tickets
```

Requires BB 0.42 or newer.

## Open it

- `Cmd+Shift+K` (`Ctrl+Shift+K` on Windows and Linux) toggles the window.
- The checklist glyph in the thread header.
- **Hmm Tickets: toggle tickets** in the command palette (`Cmd+Shift+P`).

The window opens on the board of the project you are in. On a projectless
screen it opens the project list instead.

## Queue

Mark To Do and In Progress tickets from any project as queued, then work through
them in order: the first is **Now**, the rest are **Next**.

- **Add to queue** from the ticket menu, or press `Q` on the selection. **Work on
  this next** puts one at the top.
- The **Queue** button in the board header, or the **Queue** tab on the home
  screen, shows the list. **Send to agent** on Now starts it.
- Click an item to open its ticket. Right-click it, or use its `...` menu, for
  Open, Work on this next, Move up, Move down and Remove from queue.
- `Alt+Up` / `Alt+Down` reorder the focused item and `Q` removes it.
- A ticket leaves the queue when it is done, archived or deleted.

## All projects

The back arrow in the list header opens the overview inside the same window.
Pick a project to open its board.

- Every project with its To Do, In Progress and Done counts, searchable and
  sortable. **Open project** in the `...` menu jumps to the project.
- A 14-day panel: tickets done, in progress now, projects with progress, and a
  per-day chart. **Export last 14 days** downloads a Markdown summary with the
  done list grouped by day.
- A ticket's finish date is recorded from the moment it moves to Done, so older
  Done tickets are not counted.

## The list

Tickets are grouped into **To Do**, **In Progress**, and **Done**. Done starts
collapsed and only shows tickets finished in the last two weeks; **All tickets** in
the `...` menu shows older ones too. Click a
group heading to collapse it. The search field above the list filters on title
and description; `/` focuses it.

A ticket is three fields — title, description, status. The dot at the end of a
row means the ticket has a description. A chip like `2/5` means it has
sub-tasks, two of them done.

### Creating

- `+ New`, or press `N`, opens an inline row at the top of the list. Enter
  saves it and leaves the row open for the next one.
- The ticket glyph in the composer turns the current draft into a ticket: the
  first line becomes the title, the rest the description, and the draft is
  cleared.

### Selecting

| Action | Result |
| --- | --- |
| Click | Select the row |
| Double-click | Open the ticket |
| Shift-click | Select a range |
| Cmd-click | Add or remove one |
| `↑` `↓` | Move the selection |
| `Shift+↑` `Shift+↓` | Extend it |
| `Enter` | Open the selected ticket |
| Click the title of the selected row | Rename it in place |
| `Cmd+A` | Select everything visible |
| `Esc` | Clear the search, then the selection, then leave archived, then close the window |

Right-clicking a selected row acts on the whole selection. A bar appears at the
bottom while anything is selected, with **Send all** and an overflow menu.

### The detail

Click the title to rename it in place. Opening a ticket shows it in read mode, the description rendered as Markdown.
**Edit** switches to writing; `Cmd+Enter` saves and `Esc` cancels. The footer
also carries the status picker, **Send**, archive, and delete.

### Sub-tasks

A ticket can hold sub-tasks, one level deep. In the detail, a progress bar sits
under the title and a **Sub-tasks** section sits under the description; click
`2 of 5 done` to jump to it. Type in **Add a sub-task** and press Enter to add
the next one. The checkbox toggles To Do and Done; the row menu sets In
Progress or deletes. Drag a row by its grip to reorder, or focus the grip and
press `↑` / `↓`. Click a sub-task's title to rename it in place (`Enter` saves, `Esc`
cancels), double-click the row to open it, or right-click for Open, Rename,
status and Delete. Use the parent link above an opened sub-task to go back.

Archiving and deleting a ticket takes its sub-tasks with it. When the last
sub-task is done, a toast offers to mark the parent done. Sending a ticket
includes its open sub-tasks in the prompt.

## Sending to an agent

From a row's menu, the selection bar, or the detail footer:

- **Send to new agent** — one new thread for every selected ticket together.
- **Send to N new agents** — one thread per ticket.
- **Send to this thread** — queued into the thread you are currently reading,
  so a busy agent finishes its turn first.

The ticket moves to **In Progress** and shows a spinner while the thread is
working. Its badge opens that thread. When the thread goes idle the ticket is
marked **Done**; a worker can also close it explicitly with
`bb tickets status <id> done`.

Threads run in the project checkout on your current branch. Turn on **Isolated
worktree** in the window's `...` menu to give each one a managed worktree
instead — the choice is remembered per project.

## `bb tickets`

```
bb tickets list [--status <todo|in_progress|done>] [--archived] [--json]
bb tickets show <ref> [--json]
bb tickets current [--json]
bb tickets create <title> [--description <text>] [--parent <ref>] [--json]
bb tickets update <ref> [--title <text>] [--description <text>] [--status <status>]
bb tickets status <ref>... <todo|in_progress|done>
bb tickets archive <ref>... | bb tickets unarchive <ref>...
bb tickets delete <ref>... --yes
bb tickets send <ref>... [--separate | --here | --thread <id>] [--worktree|--no-worktree]
```

A `<ref>` is a ticket id or a unique id prefix. `bb tickets current` reads the
tickets handed to the running thread, so an agent can look up its own
assignment and close it when it is finished.

## Development

```
npm install
bb plugin build
bb plugin reload hmm-tickets
```

`bb plugin dev` watches the sources and reloads on every change.

`node --experimental-strip-types --test lib/*.test.ts` checks the pure
helpers.

## License

MIT
