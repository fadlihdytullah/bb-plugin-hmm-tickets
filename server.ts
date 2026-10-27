import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { registerTicketsCli, type TicketOps } from "./cli.ts";
import { statusSchema, ticketSchema, type Status, type Ticket } from "./lib/status.ts";

const TICKETS_CHANGED = "tickets-changed";
const MAX_TITLE = 200;

const idsInput = z.object({ ids: z.array(z.string().min(1)).min(1).max(200) }).strict();
const titleField = z.string().trim().min(1).max(MAX_TITLE);
const descriptionField = z.string().max(20_000);

export const rpcContract = defineRpcContract({
  list: {
    input: z
      .object({ projectId: z.string().min(1), archived: z.boolean() })
      .strict(),
    output: z.object({ tickets: z.array(ticketSchema) }).strict(),
  },
  create: {
    input: z
      .object({
        projectId: z.string().min(1),
        parentId: z.string().min(1).optional(),
        title: titleField,
        description: descriptionField.default(""),
      })
      .strict(),
    output: z.object({ id: z.string() }).strict(),
  },
  update: {
    input: idsInput.extend({
      title: titleField.optional(),
      description: descriptionField.optional(),
      status: statusSchema.optional(),
      archived: z.boolean().optional(),
    }),
    output: z.object({}).strict(),
  },
  reorder: {
    input: z
      .object({
        parentId: z.string().min(1),
        ids: z.array(z.string().min(1)).min(1).max(200),
      })
      .strict(),
    output: z.object({}).strict(),
  },
  remove: {
    input: idsInput,
    output: z.object({}).strict(),
  },
  projects: {
    input: z.object({}).strict(),
    output: z
      .object({
        projects: z.array(
          z
            .object({
              id: z.string(),
              name: z.string(),
              todo: z.number(),
              in_progress: z.number(),
              done: z.number(),
              lastAt: z.number().nullable(),
            })
            .strict(),
        ),
      })
      .strict(),
  },
  stats: {
    input: z.object({ days: z.number().int().min(1).max(90) }).strict(),
    output: z
      .object({
        since: z.number(),
        working: z.number(),
        tracking: z.number().nullable(),
        done: z.array(
          z
            .object({
              id: z.string(),
              projectId: z.string(),
              title: z.string(),
              doneAt: z.number(),
            })
            .strict(),
        ),
      })
      .strict(),
  },
  configGet: {
    input: z.object({ projectId: z.string().min(1) }).strict(),
    output: z.object({ worktree: z.boolean(), notes: z.boolean() }).strict(),
  },
  configSet: {
    input: z
      .object({
        projectId: z.string().min(1),
        worktree: z.boolean().optional(),
        notes: z.boolean().optional(),
      })
      .strict(),
    output: z.object({}).strict(),
  },
  send: {
    input: idsInput.extend({
      separate: z.boolean().default(false),
      threadId: z.string().min(1).optional(),
      worktree: z.boolean().optional(),
      notes: z.string().max(20_000).optional(),
    }),
    output: z.object({ threadIds: z.array(z.string()) }).strict(),
  },
});

function subtasksOf(children: Row[]): string[] {
  const open = children.filter(
    (child) => child.status !== "done" && child.archived === 0,
  );
  if (open.length === 0) return [];
  return [
    "Sub-tasks:",
    "",
    ...open.map((child) => `- [${child.id.slice(0, 8)}] ${child.title}`),
    "",
    "Mark each sub-task done with `bb tickets status <id> done` as you finish it.",
  ];
}

function promptFor(
  rows: Row[],
  notes: string,
  childrenOf: (id: string) => Row[],
): string {
  const first = rows[0] as Row;
  const note = notes.trim();
  const tail = note === "" ? [] : ["", "---", "", `Note from the user:`, "", note];
  if (rows.length === 1) {
    const body = first.description.trim();
    const head = body === "" ? first.title : `${first.title}\n\n${body}`;
    const subtasks = subtasksOf(childrenOf(first.id));
    return [head, ...(subtasks.length === 0 ? [] : ["", ...subtasks]), ...tail].join(
      "\n",
    );
  }
  const items = rows.map((row, index) => {
    const body = row.description.trim();
    const head = `${index + 1}. ${row.title}  [${row.id.slice(0, 8)}]`;
    const subtasks = subtasksOf(childrenOf(row.id));
    const parts = [
      head,
      ...(body === "" ? [] : ["", body.replace(/^/gm, "   ")]),
      ...(subtasks.length === 0 ? [] : ["", ...subtasks.map((one) => `   ${one}`)]),
    ];
    return parts.join("\n");
  });
  return [
    `Work through these ${rows.length} tickets in order.`,
    "",
    ...items,
    "",
    "Mark each one done with `bb tickets status <id> done` as you finish it.",
    ...tail,
  ].join("\n");
}

interface Row {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  description: string;
  status: Status;
  archived: number;
  thread_id: string | null;
  done_at: number | null;
}

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS tickets (
       id TEXT PRIMARY KEY,
       project_id TEXT NOT NULL,
       title TEXT NOT NULL,
       description TEXT NOT NULL DEFAULT '',
       status TEXT NOT NULL DEFAULT 'todo',
       archived INTEGER NOT NULL DEFAULT 0,
       thread_id TEXT,
       created_at INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS tickets_project ON tickets (project_id, archived)`,
    `CREATE INDEX IF NOT EXISTS tickets_thread ON tickets (thread_id)`,
    `ALTER TABLE tickets ADD COLUMN parent_id TEXT`,
    `CREATE INDEX IF NOT EXISTS tickets_parent ON tickets (parent_id)`,
    `ALTER TABLE tickets ADD COLUMN position INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE tickets ADD COLUMN done_at INTEGER`,
  ]);

  const publish = (): void => {
    bb.realtime.publish(TICKETS_CHANGED, { at: Date.now() });
  };

  const configKey = (projectId: string, name: string) =>
    `${name}:${projectId}`;

  const flagOf = async (projectId: string, name: string): Promise<boolean> =>
    (await bb.storage.kv.get<boolean>(configKey(projectId, name))) ?? false;

  const environmentFor = async (projectId: string, worktree: boolean) => {
    const { sources } = await bb.sdk.projects.get({ projectId });
    const source = sources.find((one) => one.isDefault) ?? sources[0];
    if (source === undefined) return { type: "project-default" } as const;
    return {
      type: "host",
      hostId: source.hostId,
      workspace: worktree
        ? ({
            type: "managed-worktree",
            baseBranch: { kind: "default" },
          } as const)
        : ({ type: "unmanaged", path: source.path } as const),
    } as const;
  };

  const toTicket = (row: Row): Ticket => ({
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id,
    title: row.title,
    description: row.description,
    status: row.status,
    archived: row.archived === 1,
    threadId: row.thread_id,
    working: false,
  });

  const rowById = (id: string): Row => {
    const row = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as
      | Row
      | undefined;
    if (row === undefined) throw new Error("Ticket not found");
    return row;
  };

  const childrenOf = (id: string): Row[] =>
    db
      .prepare("SELECT * FROM tickets WHERE parent_id = ? ORDER BY position ASC, created_at ASC")
      .all(id) as Row[];

  const isWorking = async (threadId: string | null): Promise<boolean> => {
    if (threadId === null) return false;
    try {
      const thread = await bb.sdk.threads.get({ threadId });
      return (
        thread.deletedAt === null &&
        (thread.status === "active" ||
          thread.status === "starting" ||
          thread.status === "pending")
      );
    } catch {
      return false;
    }
  };

  const hydrate = async (ticket: Ticket): Promise<Ticket> => ({
    ...ticket,
    working: await isWorking(ticket.threadId),
  });

  const ops: TicketOps = {
    list: async ({ projectId, archived }) => {
      const rows = db
        .prepare(
          "SELECT * FROM tickets WHERE project_id = ? AND archived = ? ORDER BY position ASC, created_at ASC",
        )
        .all(projectId, archived ? 1 : 0) as Row[];
      return Promise.all(rows.map((row) => hydrate(toTicket(row))));
    },

    byProject: (projectId) =>
      (
        db
          .prepare(
            "SELECT * FROM tickets WHERE project_id = ? ORDER BY position ASC, created_at ASC",
          )
          .all(projectId) as Row[]
      ).map(toTicket),

    byThread: (threadId) =>
      (
        db
          .prepare("SELECT * FROM tickets WHERE thread_id = ?")
          .all(threadId) as Row[]
      ).map(toTicket),

    create: async ({ projectId, parentId, title, description }) => {
      const project = await bb.sdk.projects.get({ projectId });
      if (project.kind === "personal") throw new Error("Tickets need a project");
      if (parentId !== undefined) {
        const parent = rowById(parentId);
        if (parent.project_id !== projectId) {
          throw new Error("That ticket belongs to another project");
        }
        if (parent.parent_id !== null) {
          throw new Error("A sub-task cannot have sub-tasks");
        }
      }
      const id = randomUUID();
      db.prepare(
        "INSERT INTO tickets (id, project_id, parent_id, title, description, created_at, position) VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM tickets WHERE parent_id = ?))",
      ).run(
        id,
        projectId,
        parentId ?? null,
        title,
        description,
        Date.now(),
        parentId ?? null,
      );
      publish();
      return id;
    },

    update: ({ ids, title, description, status, archived }) => {
      const write = db.prepare(
        "UPDATE tickets SET title = ?, description = ?, status = ?, archived = ?, done_at = ? WHERE id = ?",
      );
      for (const id of ids) {
        const row = rowById(id);
        if (archived !== undefined && row.parent_id !== null) {
          throw new Error("Archive the parent ticket instead");
        }
        const nextStatus = status ?? row.status;
        write.run(
          title ?? row.title,
          description ?? row.description,
          nextStatus,
          (archived ?? row.archived === 1) ? 1 : 0,
          nextStatus !== "done"
            ? null
            : row.status === "done"
              ? row.done_at
              : Date.now(),
          id,
        );
        if (archived !== undefined) {
          db.prepare("UPDATE tickets SET archived = ? WHERE parent_id = ?").run(
            archived ? 1 : 0,
            id,
          );
        }
      }
      publish();
    },

    remove: (ids) => {
      const write = db.prepare("DELETE FROM tickets WHERE id = ? OR parent_id = ?");
      for (const id of ids) write.run(id, id);
      publish();
    },

    send: async (ids, separate, threadId, worktree, notes = "") => {
      const rows = ids.map(rowById);
      const first = rows[0];
      if (first === undefined) throw new Error("No ticket to send");
      const attach = db.prepare(
        "UPDATE tickets SET thread_id = ?, status = 'in_progress' WHERE id = ?",
      );

      if (threadId !== undefined) {
        const thread = await bb.sdk.threads.get({ threadId });
        if (thread.deletedAt !== null) throw new Error("That thread is gone");
        if (thread.projectId !== first.project_id) {
          throw new Error("That thread belongs to another project");
        }
        await bb.sdk.threads.send({
          threadId,
          mode: "queue-if-active",
          input: [
            {
              type: "text",
              text: promptFor(rows, notes, childrenOf),
              mentions: [],
            },
          ],
        });
        for (const row of rows) attach.run(threadId, row.id);
        publish();
        return [threadId];
      }

      const useWorktree =
        worktree ?? (await flagOf(first.project_id, "worktree"));
      const environment = await environmentFor(first.project_id, useWorktree);
      const batches = separate ? rows.map((row) => [row]) : [rows];
      const threadIds: string[] = [];
      for (const batch of batches) {
        const lead = batch[0] as Row;
        const thread = await bb.sdk.threads.spawn({
          projectId: lead.project_id,
          environment,
          title:
            batch.length === 1
              ? lead.title
              : `${lead.title} +${batch.length - 1}`,
          prompt: promptFor(batch, notes, childrenOf),
        });
        for (const row of batch) attach.run(thread.id, row.id);
        threadIds.push(thread.id);
      }
      publish();
      return threadIds;
    },

    hydrate,
  };

  bb.rpc.register(rpcContract, {
    list: async (input) => ({ tickets: await ops.list(input) }),
    create: async (input) => ({ id: await ops.create(input) }),
    update: async (input) => {
      ops.update(input);
      return {};
    },
    reorder: async ({ parentId, ids }) => {
      const siblings = new Set(childrenOf(parentId).map((row) => row.id));
      if (ids.length !== siblings.size || ids.some((id) => !siblings.has(id))) {
        throw new Error("Sub-tasks changed, try again");
      }
      const write = db.prepare("UPDATE tickets SET position = ? WHERE id = ?");
      db.transaction(() => {
        ids.forEach((id, index) => write.run(index, id));
      })();
      publish();
      return {};
    },
    remove: async ({ ids }) => {
      ops.remove(ids);
      return {};
    },
    projects: async () => {
      const counts = db
        .prepare(
          `SELECT project_id, status, COUNT(*) AS n,
                  MAX(COALESCE(done_at, created_at)) AS last_at
           FROM tickets
           WHERE parent_id IS NULL AND archived = 0
           GROUP BY project_id, status`,
        )
        .all() as {
        project_id: string;
        status: Status;
        n: number;
        last_at: number;
      }[];
      const byProject = new Map<
        string,
        { todo: number; in_progress: number; done: number; lastAt: number | null }
      >();
      for (const row of counts) {
        const entry = byProject.get(row.project_id) ?? {
          todo: 0,
          in_progress: 0,
          done: 0,
          lastAt: null,
        };
        entry[row.status] = row.n;
        entry.lastAt = Math.max(entry.lastAt ?? 0, row.last_at);
        byProject.set(row.project_id, entry);
      }
      const all = await bb.sdk.projects.list();
      return {
        projects: all
          .filter((project) => project.kind !== "personal")
          .map((project) => ({
            id: project.id,
            name: project.name,
            ...(byProject.get(project.id) ?? {
              todo: 0,
              in_progress: 0,
              done: 0,
              lastAt: null,
            }),
          })),
      };
    },
    stats: async ({ days }) => {
      const since = Date.now() - days * 86_400_000;
      const done = db
        .prepare(
          `SELECT id, project_id AS projectId, title, done_at AS doneAt
           FROM tickets
           WHERE parent_id IS NULL AND status = 'done' AND done_at >= ?
           ORDER BY done_at DESC LIMIT 1000`,
        )
        .all(since) as {
        id: string;
        projectId: string;
        title: string;
        doneAt: number;
      }[];
      const working = db
        .prepare(
          "SELECT COUNT(*) AS n FROM tickets WHERE parent_id IS NULL AND archived = 0 AND status = 'in_progress'",
        )
        .get() as { n: number };
      const first = db
        .prepare("SELECT MIN(done_at) AS at FROM tickets WHERE done_at IS NOT NULL")
        .get() as { at: number | null };
      return { since, working: working.n, tracking: first.at, done };
    },
    configGet: async ({ projectId }) => ({
      worktree: await flagOf(projectId, "worktree"),
      notes: await flagOf(projectId, "notes"),
    }),
    configSet: async ({ projectId, worktree, notes }) => {
      if (worktree !== undefined) {
        await bb.storage.kv.set(configKey(projectId, "worktree"), worktree);
      }
      if (notes !== undefined) {
        await bb.storage.kv.set(configKey(projectId, "notes"), notes);
      }
      return {};
    },
    send: async ({ ids, separate, threadId, worktree, notes }) => ({
      threadIds: await ops.send(ids, separate, threadId, worktree, notes),
    }),
  });

  registerTicketsCli(bb, ops);

  const moveByThread = (threadId: string, from: Status[], to: Status): void => {
    const result = db
      .prepare(
        `UPDATE tickets SET status = ?, done_at = ? WHERE thread_id = ? AND status IN (${from
          .map(() => "?")
          .join(",")})`,
      )
      .run(to, to === "done" ? Date.now() : null, threadId, ...from);
    if (result.changes > 0) publish();
  };

  bb.events.on("thread.active", ({ thread }) => {
    moveByThread(thread.id, ["todo", "done"], "in_progress");
  });
  bb.events.on("thread.idle", ({ thread }) => {
    moveByThread(thread.id, ["in_progress"], "done");
  });
  bb.events.on("thread.failed", () => publish());
  bb.events.on("thread.deleted", () => publish());

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
