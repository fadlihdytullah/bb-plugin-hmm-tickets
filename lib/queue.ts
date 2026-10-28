export type QueueMove = "top" | "up" | "down";

export function moveInQueue(ids: readonly string[], id: string, to: QueueMove): string[] {
  const next = [...ids];
  const at = next.indexOf(id);
  if (at === -1) throw new Error("That ticket is not in the queue");
  const target =
    to === "top" ? 0 : to === "up" ? Math.max(0, at - 1) : Math.min(next.length - 1, at + 1);
  next.splice(at, 1);
  next.splice(target, 0, id);
  return next;
}
