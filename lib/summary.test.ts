import assert from "node:assert/strict";
import { test } from "node:test";
import { isStale, type Ticket } from "./status.ts";
import { ago, perDay, summaryMarkdown } from "./summary.ts";

const now = new Date(2026, 9, 27, 12).getTime();
const at = (day: number) => new Date(2026, 9, day, 9).getTime();
const done = [
  { id: "a", projectId: "p1", title: "One", doneAt: at(27) },
  { id: "b", projectId: "p1", title: "Two", doneAt: at(27) },
  { id: "c", projectId: "p2", title: "Three", doneAt: at(20) },
];

test("perDay buckets by local day and fills gaps", () => {
  const days = perDay(done, 14, now);
  assert.equal(days.length, 14);
  assert.equal(days.at(-1)?.count, 2);
  assert.equal(days.find((d) => d.key === "2026-10-20")?.count, 1);
  assert.equal(days.reduce((sum, d) => sum + d.count, 0), 3);
});

test("summaryMarkdown lists counts, projects and items", () => {
  const names = new Map([["p1", "Alpha"], ["p2", "Beta"]]);
  const md = summaryMarkdown({ done, days: 14, now, names });
  assert.match(md, /\*\*3 done\*\* across 2 projects/);
  assert.match(md, /- Alpha: 2/);
  assert.match(md, /- \[Beta\] Three/);
});

test("ago", () => {
  assert.equal(ago(now - 2 * 3_600_000, now), "2h ago");
  assert.equal(ago(now - 3 * 86_400_000, now), "3d ago");
});

test("isStale hides Done older than 14 days, falls back to createdAt", () => {
  const base = { status: "done", createdAt: 0, doneAt: null } as Ticket;
  const day = 86_400_000;
  assert.equal(isStale({ ...base, doneAt: now - 3 * day }, now), false);
  assert.equal(isStale({ ...base, doneAt: now - 20 * day }, now), true);
  assert.equal(isStale({ ...base, createdAt: now - 20 * day }, now), true);
  assert.equal(isStale({ ...base, status: "todo", createdAt: 0 }, now), false);
});
