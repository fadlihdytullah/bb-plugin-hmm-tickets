import { z } from "zod";

export const STATUSES = ["todo", "in_progress", "done"] as const;

export const statusSchema = z.enum(STATUSES);

export type Status = z.infer<typeof statusSchema>;

export const STATUS_LABEL: Record<Status, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
};

export const ticketSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    parentId: z.string().nullable(),
    title: z.string(),
    description: z.string(),
    status: statusSchema,
    archived: z.boolean(),
    threadId: z.string().nullable(),
    working: z.boolean(),
    createdAt: z.number(),
    doneAt: z.number().nullable(),
    queuePos: z.number().nullable(),
  })
  .strict();

export type Ticket = z.infer<typeof ticketSchema>;

export const RECENT_DAYS = 14;

export function isStale(ticket: Ticket, now: number): boolean {
  return (
    ticket.status === "done" &&
    (ticket.doneAt ?? ticket.createdAt) < now - RECENT_DAYS * 86_400_000
  );
}

export function splitDraft(text: string): { title: string; description: string } {
  const trimmed = text.trim();
  const newline = trimmed.indexOf("\n");
  if (newline === -1) return { title: trimmed, description: "" };
  return {
    title: trimmed.slice(0, newline).trim(),
    description: trimmed.slice(newline + 1).trim(),
  };
}

export function progressOf(children: readonly Ticket[]): {
  done: number;
  total: number;
} {
  return {
    done: children.filter((child) => child.status === "done").length,
    total: children.length,
  };
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
