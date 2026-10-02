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
    title: z.string(),
    description: z.string(),
    status: statusSchema,
    archived: z.boolean(),
    threadId: z.string().nullable(),
    working: z.boolean(),
  })
  .strict();

export type Ticket = z.infer<typeof ticketSchema>;

export function splitDraft(text: string): { title: string; description: string } {
  const trimmed = text.trim();
  const newline = trimmed.indexOf("\n");
  if (newline === -1) return { title: trimmed, description: "" };
  return {
    title: trimmed.slice(0, newline).trim(),
    description: trimmed.slice(newline + 1).trim(),
  };
}
