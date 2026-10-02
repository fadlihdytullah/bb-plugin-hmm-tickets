# Hmm Tickets

A small ticket list that lives where the work does: a floating window per
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

Tickets belong to a project, so the window stays hidden on the home screen,
settings, or any other projectless route.

## The list

Tickets are grouped into **To Do**, **In Progress**, and **Done**. Click a
group heading to collapse it. The search field above the list filters on title
and description; `/` focuses it.

A ticket is three fields — title, description, status. The dot at the end of a
row means the ticket has a description.

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
| `Cmd+A` | Select everything visible |
| `Esc` | Clear the search, then the selection |

Right-clicking a selected row acts on the whole selection. A bar appears at the
bottom while anything is selected, with **Send all** and an overflow menu.

### The detail

Opening a ticket shows it in read mode, the description rendered as Markdown.
**Edit** switches to writing; `Cmd+Enter` saves and `Esc` cancels. The footer
also carries the status picker, **Send**, archive, and delete.

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
bb tickets create <title> [--description <text>] [--json]
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

## License

MIT
