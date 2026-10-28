import assert from "node:assert/strict";
import { test } from "node:test";
import { moveInQueue } from "./queue.ts";

test("moveInQueue moves and clamps", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(moveInQueue(ids, "c", "top"), ["c", "a", "b"]);
  assert.deepEqual(moveInQueue(ids, "b", "up"), ["b", "a", "c"]);
  assert.deepEqual(moveInQueue(ids, "a", "up"), ["a", "b", "c"]);
  assert.deepEqual(moveInQueue(ids, "b", "down"), ["a", "c", "b"]);
  assert.deepEqual(moveInQueue(ids, "c", "down"), ["a", "b", "c"]);
  assert.throws(() => moveInQueue(ids, "x", "top"));
});
