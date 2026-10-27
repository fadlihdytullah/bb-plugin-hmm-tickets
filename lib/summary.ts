export interface DoneItem {
  id: string;
  projectId: string;
  title: string;
  doneAt: number;
}

const DAY = 86_400_000;

export function dayKey(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en", { month: "short", day: "numeric" });
}

export function longDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function perDay(
  done: readonly DoneItem[],
  days: number,
  now: number,
): { key: string; at: number; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of done) {
    const key = dayKey(item.doneAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (days - 1 - index));
    const key = dayKey(date.getTime());
    return { key, at: date.getTime(), count: counts.get(key) ?? 0 };
  });
}

export function ago(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / DAY)}d ago`;
}

export function summaryMarkdown(input: {
  done: readonly DoneItem[];
  days: number;
  now: number;
  names: ReadonlyMap<string, string>;
}): string {
  const { done, days, now, names } = input;
  const name = (id: string) => names.get(id) ?? "Unknown project";
  const buckets = perDay(done, days, now);
  const busiest = buckets.reduce((best, one) => (one.count > best.count ? one : best));
  const byProject = new Map<string, number>();
  for (const item of done) {
    byProject.set(item.projectId, (byProject.get(item.projectId) ?? 0) + 1);
  }
  const projects = [...byProject].sort((a, b) => b[1] - a[1]);
  const lines = [
    `# Tickets summary: ${shortDate(buckets[0]?.at ?? now)} to ${shortDate(now)}`,
    "",
    `**${done.length} done** across ${projects.length} ${projects.length === 1 ? "project" : "projects"}` +
      (busiest.count > 0 ? `. Busiest day: ${longDate(busiest.at)} (${busiest.count}).` : "."),
    "",
    "## By project",
    "",
    ...projects.map(([id, count]) => `- ${name(id)}: ${count}`),
    "",
    "## Done",
  ];
  for (const bucket of [...buckets].reverse()) {
    const items = done.filter((item) => dayKey(item.doneAt) === bucket.key);
    if (items.length === 0) continue;
    lines.push("", `### ${longDate(bucket.at)}`, "");
    for (const item of items) lines.push(`- [${name(item.projectId)}] ${item.title}`);
  }
  return `${lines.join("\n")}\n`;
}
