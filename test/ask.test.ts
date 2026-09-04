import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DONE_LABEL,
  MAX_QUESTIONS,
  OTHER_LABEL,
  formatAnswers,
  labelFromDisplay,
  optionDisplay,
  parseToggleRow,
  toggleRows,
  validateQuestions,
  type AskOption,
} from "../src/ask.ts";

const OPTS: AskOption[] = [
  { label: "Postgres (Recommended)", description: "relational, battle-tested" },
  { label: "SQLite" },
];

test("validateQuestions accepts a clean batch", () => {
  const result = validateQuestions([
    { question: "Which database?", options: OPTS },
    { question: "Enable cache?", options: [{ label: "Yes" }, { label: "No" }], multiSelect: false },
  ]);
  assert.equal(result.error, null);
  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0]!.allowOther, true);
  assert.equal(result.questions[0]!.multiSelect, false);
});

test("validateQuestions drops junk with warnings and caps counts", () => {
  const many = Array.from({ length: MAX_QUESTIONS + 2 }, (_, i) => ({
    question: `q${i}?`,
    options: [{ label: "a" }],
  }));
  const capped = validateQuestions(many);
  assert.equal(capped.questions.length, MAX_QUESTIONS);
  assert.ok(capped.warnings.some((w) => w.includes("capped")));

  const messy = validateQuestions([
    { question: "", options: OPTS },
    { question: "ok?", options: [{ label: "" }, { label: "fine" }, "junk"] },
    { question: "no opts, no other", options: [], allowOther: false },
  ]);
  assert.equal(messy.questions.length, 1);
  assert.equal(messy.questions[0]!.options.length, 1);
  assert.ok(messy.warnings.length >= 3);
});

test("validateQuestions rejects empty input", () => {
  assert.ok(validateQuestions([]).error);
  assert.ok(validateQuestions("x").error);
  assert.ok(validateQuestions([{ question: "" }]).error);
});

test("optionDisplay and labelFromDisplay round-trip", () => {
  const display = optionDisplay(OPTS[0]!);
  assert.ok(display.includes("Postgres (Recommended)"));
  assert.ok(display.includes("—"));
  assert.equal(labelFromDisplay(display, OPTS), "Postgres (Recommended)");
  assert.equal(labelFromDisplay(optionDisplay(OPTS[1]!), OPTS), "SQLite");
  assert.equal(labelFromDisplay("nonsense", OPTS), null);
});

test("optionDisplay truncates long descriptions", () => {
  const long = optionDisplay({ label: "x", description: "d".repeat(100) });
  assert.ok(long.length < 100);
  assert.ok(long.includes("…"));
});

test("toggleRows renders checkboxes, Done, and Other", () => {
  const rows = toggleRows(OPTS, new Set([1]), true);
  assert.ok(rows[0]!.startsWith("[ ] "));
  assert.ok(rows[1]!.startsWith("[x] "));
  assert.equal(rows[2], DONE_LABEL);
  assert.equal(rows[3], OTHER_LABEL);
  assert.equal(toggleRows(OPTS, new Set(), false).length, 3);
});

test("parseToggleRow maps rows to actions", () => {
  const rows = toggleRows(OPTS, new Set([0]), true);
  assert.deepEqual(parseToggleRow(rows[0]!, OPTS), { kind: "toggle", index: 0 });
  assert.deepEqual(parseToggleRow(rows[1]!, OPTS), { kind: "toggle", index: 1 });
  assert.deepEqual(parseToggleRow(DONE_LABEL, OPTS), { kind: "done" });
  assert.deepEqual(parseToggleRow(OTHER_LABEL, OPTS), { kind: "other" });
  assert.equal(parseToggleRow("[x] mystery", OPTS), null);
});

test("formatAnswers renders selections, other, declined, empty", () => {
  const text = formatAnswers([
    { question: "Which db?", answers: ["Postgres (Recommended)"] },
    { question: "Features?", answers: ["a", "b"], other: "and c" },
    { question: "Skipped?", answers: [], declined: true },
    { question: "None?", answers: [] },
  ]);
  assert.ok(text.includes("A: Postgres (Recommended)"));
  assert.ok(text.includes("A: a; b; Other: and c"));
  assert.ok(text.includes("(the user declined to answer)"));
  assert.ok(text.includes("(no selection)"));
});
