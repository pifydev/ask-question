import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASK_STATE,
  DONE_LABEL,
  MAX_HEADER,
  MAX_QUESTIONS,
  OTHER_LABEL,
  formatAnswers,
  headlessText,
  normalizeOptions,
  parseAskRoute,
  questionTitle,
  replayRounds,
  routeText,
  parseSingleRow,
  singleRows,
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

test("an optional header is parsed, trimmed and clipped; the title shows it as a chip", () => {
  const r = validateQuestions([
    { question: "Which strategy?", options: OPTS, header: "  Auth method  " },
    { question: "Cache?", options: OPTS, header: "x".repeat(40) },
    { question: "No header?", options: OPTS },
  ]);
  assert.equal(r.questions[0]!.header, "Auth method");
  assert.equal(r.questions[1]!.header!.length, MAX_HEADER, "clipped to the max");
  assert.equal(r.questions[2]!.header, undefined);
  assert.equal(questionTitle(r.questions[0]!), "[Auth method] Which strategy?");
  assert.equal(questionTitle(r.questions[2]!), "No header?", "no chip when there is no header");
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

test("optionDisplay renders label and description", () => {
  const display = optionDisplay(OPTS[0]!);
  assert.ok(display.includes("Postgres (Recommended)"));
  assert.ok(display.includes("—"));
});

test("v0.2 parseSingleRow resolves by position, not by text", () => {
  const rows = singleRows(OPTS, true);
  assert.deepEqual(parseSingleRow(rows[0]!, rows, OPTS), { kind: "option", index: 0 });
  assert.deepEqual(parseSingleRow(rows[1]!, rows, OPTS), { kind: "option", index: 1 });
  assert.deepEqual(parseSingleRow(OTHER_LABEL, rows, OPTS), { kind: "other" });
  assert.equal(parseSingleRow("nonsense", rows, OPTS), null);
  // an option that reads like the control row is renamed, then stays an option
  const shadowed = normalizeOptions([{ label: OTHER_LABEL }]).options;
  const shadowRows = singleRows(shadowed, true);
  assert.deepEqual(parseSingleRow(shadowRows[0]!, shadowRows, shadowed), { kind: "option", index: 0 });
  assert.deepEqual(parseSingleRow(shadowRows[1]!, shadowRows, shadowed), { kind: "other" });
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
  assert.deepEqual(parseToggleRow(rows[0]!, rows, OPTS), { kind: "toggle", index: 0 });
  assert.deepEqual(parseToggleRow(rows[1]!, rows, OPTS), { kind: "toggle", index: 1 });
  assert.deepEqual(parseToggleRow(DONE_LABEL, rows, OPTS), { kind: "done" });
  assert.deepEqual(parseToggleRow(OTHER_LABEL, rows, OPTS), { kind: "other" });
  assert.equal(parseToggleRow("[x] mystery", rows, OPTS), null);
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

test("v0.2 normalizeOptions makes every row distinguishable", () => {
  const { options, warnings } = normalizeOptions([
    { label: "Keep" },
    { label: "Keep" },
    { label: "Keep" },
    { label: OTHER_LABEL },
  ]);
  assert.deepEqual(
    options.map((o) => o.label),
    ["Keep", "Keep (2)", "Keep (3)", `${OTHER_LABEL} (option)`],
  );
  assert.equal(warnings.length, 3);
  // descriptions survive the rename
  const withDesc = normalizeOptions([{ label: "a", description: "d" }, { label: "a" }]);
  assert.equal(withDesc.options[0]!.description, "d");
  assert.equal(normalizeOptions([{ label: "a" }, { label: "b" }]).warnings.length, 0);
});

test("v0.2 duplicate labels are selectable through validateQuestions", () => {
  const result = validateQuestions([
    { question: "Which one?", options: [{ label: "Keep" }, { label: "Keep" }] },
  ]);
  const q = result.questions[0]!;
  const rows = toggleRows(q.options, new Set(), false);
  assert.deepEqual(parseToggleRow(rows[1]!, rows, q.options), { kind: "toggle", index: 1 });
  assert.ok(result.warnings.some((w) => w.includes("duplicate")));
});

test("v0.2 headlessText replays the questions it would have asked", () => {
  const { questions } = validateQuestions([
    {
      question: "Which database?",
      options: [{ label: "Postgres", description: "durable" }, { label: "SQLite" }],
      allowOther: false,
    },
    { question: "Anything else?", options: [{ label: "No" }] },
  ]);
  const text = headlessText(questions);
  assert.ok(text.includes("Q: Which database?"));
  assert.ok(text.includes("- Postgres — durable"));
  assert.ok(text.includes("- SQLite"));
  assert.ok(text.includes("Q: Anything else?"));
  // only the question that allows it advertises free text
  assert.equal(text.split("(free text)").length - 1, 1);
  assert.ok(text.includes("state the assumption") || text.includes("which option you assumed"));
});

test("v0.3 /ask routes parse", () => {
  assert.deepEqual(parseAskRoute(""), { kind: "last" });
  assert.deepEqual(parseAskRoute("  LAST "), { kind: "last" });
  assert.deepEqual(parseAskRoute("all"), { kind: "all" });
  assert.deepEqual(parseAskRoute("history"), { kind: "all" });
  assert.deepEqual(parseAskRoute("help"), { kind: "help" });
  assert.deepEqual(parseAskRoute("wat"), { kind: "unknown", input: "wat" });
});

test("v0.3 rounds are appended, never collapsed", () => {
  const round = (label: string, ts: number) => ({
    type: "custom",
    customType: ASK_STATE,
    data: { timestamp: ts, answers: [{ question: `Q ${label}?`, answers: [label] }] },
  });
  const rounds = replayRounds([
    round("first", 1),
    { type: "custom", customType: "other", data: { answers: [] } },
    { type: "message", data: null },
    round("second", 2),
    { type: "custom", customType: ASK_STATE, data: { junk: true } },
  ]);
  assert.equal(rounds.length, 2);
  assert.equal(rounds[0]!.answers[0]!.answers[0], "first");
  assert.equal(rounds[1]!.timestamp, 2);
  assert.deepEqual(replayRounds([]), []);
});

test("v0.3 /ask renders the last round and the whole history", () => {
  const rounds = [
    { timestamp: new Date(2026, 8, 6, 9, 5).getTime(), answers: [{ question: "DB?", answers: ["Postgres"] }] },
    { timestamp: new Date(2026, 8, 6, 11, 30).getTime(), answers: [{ question: "Deploy?", answers: [], declined: true }] },
  ];
  const last = routeText(parseAskRoute("last"), rounds);
  assert.ok(last.includes("Deploy?"));
  assert.ok(last.includes("declined"));
  assert.ok(last.includes("11:30"));
  assert.ok(!last.includes("Postgres"));

  const all = routeText(parseAskRoute("all"), rounds);
  assert.ok(all.includes("#1") && all.includes("#2"));
  assert.ok(all.includes("Postgres") && all.includes("Deploy?"));

  assert.ok(routeText(parseAskRoute("last"), []).includes("No questions"));
  assert.ok(routeText(parseAskRoute("all"), []).includes("No questions"));
  assert.ok(routeText(parseAskRoute("wat"), rounds).includes("Usage:"));
});
