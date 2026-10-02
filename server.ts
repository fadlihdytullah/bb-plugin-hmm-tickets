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
  remove: {
    input: idsInput,
    output: z.object({}).strict(),
  },
  configGet: {
    input: z.object({ projectId: z.string().min(1) }).strict(),
    output: z.object({ worktree: z.boolean() }).strict(),
  },
  configSet: {
    input: z
      .object({ projectId: z.string().min(1), worktree: z.boolean() })
      .strict(),
    output: z.object({}).strict(),
  },
  send: {
    input: idsInput.extend({
      separate: z.boolean().default(false),
      threadId: z.string().min(1).optional(),
      worktree: z.boolean().optional(),
    }),
    output: z.object({ threadIds: z.array(z.string()) }).strict(),
  },
});

function promptFor(rows: Row[]): string {
  const first = rows[0] as Row;
  if (rows.length === 1) {
    const body = first.description.trim();
    return body === "" ? first.title : `${first.title}\n\n${body}`;
  }
  const items = rows.map((row, index) => {
    const body = row.description.trim();
    const head = `${index + 1}. ${row.title}  [${row.id.slice(0, 8)}]`;
    return body === "" ? head : `${head}\n\n${body.replace(/^/gm, "   ")}`;
  });
  return [
    `Work through these ${rows.length} tickets in order.`,
    "",
    ...items,
    "",
    "Mark each one done with `bb tickets status <id> done` as you finish it.",
  ].join("\n");
}

interface Row {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: Status;
  archived: number;
  thread_id: string | null;
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
  ]);

  const publish = (): void => {
    bb.realtime.publish(TICKETS_CHANGED, { at: Date.now() });
  };

  const worktreeKey = (projectId: string) => `worktree:${projectId}`;

  const worktreeOf = async (projectId: string): Promise<boolean> =>
    (await bb.storage.kv.get<boolean>(worktreeKey(projectId))) ?? false;

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
          "SELECT * FROM tickets WHERE project_id = ? AND archived = ? ORDER BY created_at ASC",
        )
        .all(projectId, archived ? 1 : 0) as Row[];
      return Promise.all(rows.map((row) => hydrate(toTicket(row))));
    },

    byProject: (projectId) =>
      (
        db
          .prepare(
            "SELECT * FROM tickets WHERE project_id = ? ORDER BY created_at ASC",
          )
          .all(projectId) as Row[]
      ).map(toTicket),

    byThread: (threadId) =>
      (
        db
          .prepare("SELECT * FROM tickets WHERE thread_id = ?")
          .all(threadId) as Row[]
      ).map(toTicket),

    create: async ({ projectId, title, description }) => {
      const project = await bb.sdk.projects.get({ projectId });
      if (project.kind === "personal") throw new Error("Tickets need a project");
      const id = randomUUID();
      db.prepare(
        "INSERT INTO tickets (id, project_id, title, description, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, projectId, title, description, Date.now());
      publish();
      return id;
    },

    update: ({ ids, title, description, status, archived }) => {
      const write = db.prepare(
        "UPDATE tickets SET title = ?, description = ?, status = ?, archived = ? WHERE id = ?",
      );
      for (const id of ids) {
        const row = rowById(id);
        write.run(
          title ?? row.title,
          description ?? row.description,
          status ?? row.status,
          (archived ?? row.archived === 1) ? 1 : 0,
          id,
        );
      }
      publish();
    },

    remove: (ids) => {
      const write = db.prepare("DELETE FROM tickets WHERE id = ?");
      for (const id of ids) write.run(id);
      publish();
    },

    send: async (ids, separate, threadId, worktree) => {
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
          input: [{ type: "text", text: promptFor(rows), mentions: [] }],
        });
        for (const row of rows) attach.run(threadId, row.id);
        publish();
        return [threadId];
      }

      const useWorktree = worktree ?? (await worktreeOf(first.project_id));
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
          prompt: promptFor(batch),
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
    remove: async ({ ids }) => {
      ops.remove(ids);
      return {};
    },
    configGet: async ({ projectId }) => ({
      worktree: await worktreeOf(projectId),
    }),
    configSet: async ({ projectId, worktree }) => {
      await bb.storage.kv.set(worktreeKey(projectId), worktree);
      return {};
    },
    send: async ({ ids, separate, threadId, worktree }) => ({
      threadIds: await ops.send(ids, separate, threadId, worktree),
    }),
  });

  registerTicketsCli(bb, ops);

  const moveByThread = (threadId: string, from: Status[], to: Status): void => {
    const result = db
      .prepare(
        `UPDATE tickets SET status = ? WHERE thread_id = ? AND status IN (${from
          .map(() => "?")
          .join(",")})`,
      )
      .run(to, threadId, ...from);
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
