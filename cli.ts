import type { BbPluginApi, PluginCliResult } from "@get-bb/plugin-sdk";
import { flagString, parseArgs } from "./lib/args.ts";
import {
  STATUS_LABEL,
  STATUSES,
  statusSchema,
  type Status,
  type Ticket,
} from "./lib/status.ts";

export interface TicketOps {
  list(input: { projectId: string; archived: boolean }): Promise<Ticket[]>;
  byProject(projectId: string): Ticket[];
  byThread(threadId: string): Ticket[];
  create(input: {
    projectId: string;
    title: string;
    description: string;
  }): Promise<string>;
  update(input: {
    ids: string[];
    title?: string;
    description?: string;
    status?: Status;
    archived?: boolean;
  }): void;
  remove(ids: string[]): void;
  send(
    ids: string[],
    separate: boolean,
    threadId?: string,
    worktree?: boolean,
  ): Promise<string[]>;
  hydrate(ticket: Ticket): Promise<Ticket>;
}

const USAGE = `bb tickets <command>

  list [--status <todo|in_progress|done>] [--archived] [--project <id>] [--json]
  show <ref> [--json]
  current [--json]
  create <title> [--description <text>] [--project <id>] [--json]
  update <ref> [--title <text>] [--description <text>] [--status <status>]
  status <ref>... <todo|in_progress|done>
  archive <ref>... | unarchive <ref>...
  delete <ref>... --yes
  send <ref>... [--separate | --here | --thread <id>] [--worktree|--no-worktree]
       [--json]

A <ref> is a ticket id or a unique id prefix. Commands taking <ref>... accept
several. send opens one new thread for every ticket together; --separate opens
one thread per ticket, --here sends into the calling thread, and --thread <id>
sends into a named thread.`;

const ok = (stdout: string): PluginCliResult => ({ exitCode: 0, stdout });
const fail = (stderr: string): PluginCliResult => ({ exitCode: 1, stderr });

function shortId(id: string): string {
  return id.slice(0, 8);
}

function line(ticket: Ticket): string {
  const thread = ticket.threadId === null ? "" : ` · ${ticket.threadId}`;
  const working = ticket.working ? " · working" : "";
  return `  ${shortId(ticket.id)}  ${ticket.title}${thread}${working}`;
}

function detail(ticket: Ticket): string {
  const rows = [
    `id          ${ticket.id}`,
    `title       ${ticket.title}`,
    `status      ${STATUS_LABEL[ticket.status]}`,
    `archived    ${ticket.archived ? "yes" : "no"}`,
    `thread      ${ticket.threadId ?? "—"}${ticket.working ? " (working)" : ""}`,
  ];
  if (ticket.description.trim() !== "") {
    rows.push("", ticket.description.trim());
  }
  return rows.join("\n");
}

export function registerTicketsCli(bb: BbPluginApi, ops: TicketOps): void {
  const resolve = (projectId: string, ref: string): Ticket => {
    const all = ops.byProject(projectId);
    const exact = all.find((ticket) => ticket.id === ref);
    if (exact !== undefined) return exact;
    const matches = all.filter((ticket) => ticket.id.startsWith(ref));
    if (matches.length === 1) return matches[0] as Ticket;
    if (matches.length === 0) throw new Error(`No ticket matches "${ref}"`);
    throw new Error(`"${ref}" matches ${matches.length} tickets`);
  };

  const resolveAll = (projectId: string, refs: string[]): Ticket[] => {
    const seen = new Set<string>();
    const tickets: Ticket[] = [];
    for (const ref of refs) {
      const ticket = resolve(projectId, ref);
      if (seen.has(ticket.id)) continue;
      seen.add(ticket.id);
      tickets.push(ticket);
    }
    return tickets;
  };

  const parseStatus = (value: string): Status => {
    const parsed = statusSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`Status must be one of ${STATUSES.join(", ")}`);
    }
    return parsed.data;
  };

  bb.cli.register({
    name: "tickets",
    summary: "Create and manage this project's tickets",
    commands: [
      {
        name: "list",
        summary: "List tickets grouped by status",
        usage: "bb tickets list [--status <status>] [--archived] [--json]",
      },
      {
        name: "show",
        summary: "Show one ticket in full",
        usage: "bb tickets show <ref> [--json]",
      },
      {
        name: "current",
        summary: "Show the tickets handed to this thread",
        usage: "bb tickets current [--json]",
      },
      {
        name: "create",
        summary: "Create a ticket",
        usage: "bb tickets create <title> [--description <text>] [--json]",
      },
      {
        name: "update",
        summary: "Change a ticket's title, description, or status",
        usage:
          "bb tickets update <ref> [--title <text>] [--description <text>] [--status <status>]",
      },
      {
        name: "status",
        summary: "Move a ticket to another status",
        usage: "bb tickets status <ref>... <todo|in_progress|done>",
      },
      {
        name: "archive",
        summary: "Archive or unarchive a ticket",
        usage: "bb tickets archive <ref>... | bb tickets unarchive <ref>...",
      },
      {
        name: "delete",
        summary: "Permanently delete a ticket",
        usage: "bb tickets delete <ref>... --yes",
      },
      {
        name: "send",
        summary: "Hand one or more tickets to a new agent thread",
        usage:
          "bb tickets send <ref>... [--separate | --here | --thread <id>] [--worktree|--no-worktree] [--json]",
      },
    ],
    run: async (argv, ctx) => {
      const { positional, flags } = parseArgs(argv);
      const [command, ...rest] = positional;
      const json = flags["json"] === true;

      if (command === undefined || command === "help") return ok(USAGE);

      const projectOf = (): string => {
        const id = flagString(flags, "project") ?? ctx.projectId;
        if (id === undefined || id === "") {
          throw new Error("No project in context; pass --project <id>");
        }
        return id;
      };

      try {
        switch (command) {
          case "list": {
            const projectId = projectOf();
            const archived = flags["archived"] === true;
            const filter = flagString(flags, "status");
            const wanted = filter === undefined ? null : parseStatus(filter);
            const tickets = (
              await ops.list({ projectId, archived })
            ).filter((ticket) => wanted === null || ticket.status === wanted);
            if (json) return ok(JSON.stringify({ tickets }, null, 2));
            if (tickets.length === 0) {
              return ok(archived ? "No archived tickets" : "No tickets");
            }
            const groups = STATUSES.flatMap((status) => {
              const group = tickets.filter(
                (ticket) => ticket.status === status,
              );
              if (group.length === 0) return [];
              return [
                `${STATUS_LABEL[status]} (${group.length})`,
                ...group.map(line),
              ];
            });
            return ok(groups.join("\n"));
          }

          case "show": {
            const ref = rest[0];
            if (ref === undefined) return fail("Usage: bb tickets show <ref>");
            const ticket = await ops.hydrate(resolve(projectOf(), ref));
            return ok(json ? JSON.stringify(ticket, null, 2) : detail(ticket));
          }

          case "current": {
            if (ctx.threadId === undefined) {
              return fail("No thread in context");
            }
            const tickets = await Promise.all(
              ops.byThread(ctx.threadId).map((ticket) => ops.hydrate(ticket)),
            );
            if (json) return ok(JSON.stringify({ tickets }, null, 2));
            if (tickets.length === 0) {
              return ok("No ticket is attached to this thread");
            }
            return ok(tickets.map(detail).join("\n\n"));
          }

          case "create": {
            const title = rest.join(" ").trim();
            if (title === "") {
              return fail("Usage: bb tickets create <title>");
            }
            const id = await ops.create({
              projectId: projectOf(),
              title,
              description: flagString(flags, "description") ?? "",
            });
            return ok(json ? JSON.stringify({ id }, null, 2) : id);
          }

          case "update": {
            const ref = rest[0];
            if (ref === undefined) {
              return fail("Usage: bb tickets update <ref> [--status <status>]");
            }
            const ticket = resolve(projectOf(), ref);
            const status = flagString(flags, "status");
            ops.update({
              ids: [ticket.id],
              title: flagString(flags, "title"),
              description: flagString(flags, "description"),
              status: status === undefined ? undefined : parseStatus(status),
            });
            return ok(`Updated ${shortId(ticket.id)}`);
          }

          case "status": {
            const value = rest.at(-1);
            const refs = rest.slice(0, -1);
            if (value === undefined || refs.length === 0) {
              return fail(
                `Usage: bb tickets status <ref>... <${STATUSES.join("|")}>`,
              );
            }
            const status = parseStatus(value);
            const tickets = resolveAll(projectOf(), refs);
            ops.update({ ids: tickets.map((ticket) => ticket.id), status });
            return ok(
              `${tickets.length} ticket(s) → ${STATUS_LABEL[status]}`,
            );
          }

          case "archive":
          case "unarchive": {
            if (rest.length === 0) {
              return fail(`Usage: bb tickets ${command} <ref>...`);
            }
            const tickets = resolveAll(projectOf(), rest);
            ops.update({
              ids: tickets.map((ticket) => ticket.id),
              archived: command === "archive",
            });
            return ok(
              `${command === "archive" ? "Archived" : "Unarchived"} ${tickets.length} ticket(s)`,
            );
          }

          case "delete": {
            if (rest.length === 0) {
              return fail("Usage: bb tickets delete <ref>... --yes");
            }
            const tickets = resolveAll(projectOf(), rest);
            if (flags["yes"] !== true) {
              return fail(
                `Refusing to delete ${tickets.length} ticket(s) without --yes`,
              );
            }
            ops.remove(tickets.map((ticket) => ticket.id));
            return ok(`Deleted ${tickets.length} ticket(s)`);
          }

          case "send": {
            if (rest.length === 0) {
              return fail("Usage: bb tickets send <ref>... [--separate]");
            }
            const tickets = resolveAll(projectOf(), rest);
            const requested =
              flags["here"] === true
                ? ctx.threadId
                : flagString(flags, "thread");
            const target =
              requested === undefined || requested === "" ? undefined : requested;
            if (flags["here"] === true && target === undefined) {
              return fail("No thread in context; pass --thread <id>");
            }
            if (flags["thread"] !== undefined && target === undefined) {
              return fail("--thread needs a thread id");
            }
            const worktree =
              flags["worktree"] === true
                ? true
                : flags["no-worktree"] === true
                  ? false
                  : undefined;
            const threadIds = await ops.send(
              tickets.map((ticket) => ticket.id),
              flags["separate"] === true,
              target,
              worktree,
            );
            return ok(
              json
                ? JSON.stringify({ threadIds }, null, 2)
                : threadIds.join("\n"),
            );
          }

          default:
            return fail(`Unknown command "${command}"\n\n${USAGE}`);
        }
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  });
}
