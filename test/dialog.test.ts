import { test } from "node:test";
import assert from "node:assert/strict";
import askQuestion from "../extensions/ask-question.ts";
import { DONE_LABEL, OTHER_LABEL } from "../src/ask.ts";

/**
 * The dialog flow, end to end through the real tool.
 *
 * The suite review found this package's headline behaviour — the select
 * loop, multi-select toggling, Esc declining the rest of the batch, the
 * headless branch, and the appendEntry record — had no test of any kind:
 * the one test file covered pure helpers only. A real TUI cannot be driven
 * from here, but the TUI is pi's; everything this package adds lives in
 * `execute`, and `execute` sees the UI only through `ctx.ui.select` and
 * `ctx.ui.input`. So a stub host with scripted answers exercises the actual
 * shipped loop — not a reimplementation of it — and pins every branch the
 * README describes.
 *
 * Each scripted step is a function of (title, rows) returning the row it
 * picks (or undefined for Esc), so tests choose by content the way a person
 * does, and a change to row wording that breaks selection breaks the test.
 */

type SelectStep = (title: string, rows: string[]) => string | undefined;

function host() {
  const appended: Array<{ type: string; data: unknown }> = [];
  let tool: {
    execute: (
      id: string,
      params: unknown,
      signal: undefined,
      onUpdate: undefined,
      ctx: unknown,
    ) => Promise<{ content: Array<{ type: string; text: string }>; details?: unknown }>;
  } | null = null;

  const pi = {
    registerTool(def: never) {
      tool = def;
    },
    registerCommand() {},
    appendEntry(type: string, data: unknown) {
      appended.push({ type, data });
    },
    on() {},
    sendMessage() {},
  };
  askQuestion(pi as never);
  if (!tool) throw new Error("the extension did not register its tool");

  const selects: SelectStep[] = [];
  const inputs: Array<string | undefined> = [];
  const selectLog: Array<{ title: string; rows: string[] }> = [];
  const ctx = {
    hasUI: true,
    ui: {
      async select(title: string, rows: string[]) {
        selectLog.push({ title, rows });
        const step = selects.shift();
        if (!step) throw new Error(`unscripted select: ${title}`);
        return step(title, rows);
      },
      async input() {
        if (inputs.length === 0) throw new Error("unscripted input");
        return inputs.shift();
      },
      notify() {},
    },
  };

  return {
    appended,
    selects,
    inputs,
    selectLog,
    ctx,
    ask: (params: unknown) => tool!.execute("t1", params, undefined, undefined, ctx),
  };
}

const pickRow = (needle: string): SelectStep => {
  return (_title, rows) => {
    const row = rows.find((r) => r.includes(needle));
    if (!row) throw new Error(`no row containing "${needle}" in: ${rows.join(" | ")}`);
    return row;
  };
};
const esc: SelectStep = () => undefined;

const q = (over: Record<string, unknown> = {}) => ({
  question: "Tabs or spaces?",
  options: [{ label: "Tabs" }, { label: "Spaces", description: "two of them" }],
  ...over,
});

test("single select answers with the chosen option", async () => {
  const h = host();
  h.selects.push(pickRow("Spaces"));
  const result = await h.ask({ questions: [q()] });
  assert.match(result.content[0]!.text, /Spaces/);
  assert.equal((result.details as { answers: Array<{ answers: string[] }> }).answers[0]!.answers[0], "Spaces");
});

test("the Other path collects free text through ui.input", async () => {
  const h = host();
  h.selects.push(pickRow(OTHER_LABEL));
  h.inputs.push("three-space indent");
  const result = await h.ask({ questions: [q()] });
  const answer = (result.details as { answers: Array<{ other?: string }> }).answers[0]!;
  assert.equal(answer.other, "three-space indent");
});

test("Esc on a single select is a decline, not an error", async () => {
  const h = host();
  h.selects.push(esc);
  const result = await h.ask({ questions: [q()] });
  const answer = (result.details as { answers: Array<{ declined?: boolean }> }).answers[0]!;
  assert.equal(answer.declined, true);
  assert.match(result.content[0]!.text, /decline/i);
});

test("multi-select toggles: on, on, off again, then done", async () => {
  const h = host();
  // Toggle Tabs on, Spaces on, Tabs OFF, then finish — only Spaces survives.
  h.selects.push(pickRow("Tabs"), pickRow("Spaces"), pickRow("Tabs"), pickRow(DONE_LABEL));
  const result = await h.ask({ questions: [q({ multiSelect: true })] });
  const answer = (result.details as { answers: Array<{ answers: string[] }> }).answers[0]!;
  assert.deepEqual(answer.answers, ["Spaces"]);
  // Four visits to the select loop, as scripted — the loop is real.
  assert.equal(h.selectLog.length, 4);
});

test("multi-select Other adds text and keeps toggling", async () => {
  const h = host();
  h.selects.push(pickRow("Tabs"), pickRow(OTHER_LABEL), pickRow(DONE_LABEL));
  h.inputs.push("mixed, by file type");
  const result = await h.ask({ questions: [q({ multiSelect: true })] });
  const answer = (result.details as { answers: Array<{ answers: string[]; other?: string }> }).answers[0]!;
  assert.deepEqual(answer.answers, ["Tabs"]);
  assert.equal(answer.other, "mixed, by file type");
});

test("Esc declines the whole remaining batch without asking it", async () => {
  const h = host();
  h.selects.push(esc); // decline question 1 — question 2 must never be shown
  const result = await h.ask({
    questions: [q(), { question: "Semicolons?", options: [{ label: "Yes" }, { label: "No" }] }],
  });
  const answers = (result.details as { answers: Array<{ declined?: boolean }> }).answers;
  assert.equal(answers.length, 2);
  assert.equal(answers[0]!.declined, true);
  assert.equal(answers[1]!.declined, true);
  // The user opted out of the questionnaire; showing question 2 anyway is
  // exactly what the early-out exists to prevent.
  assert.equal(h.selectLog.length, 1);
});

test("every round is appended to the session, declined or not", async () => {
  const h = host();
  h.selects.push(pickRow("Tabs"));
  await h.ask({ questions: [q()] });
  assert.equal(h.appended.length, 1);
  const round = h.appended[0]!.data as { answers: Array<{ answers: string[] }> };
  assert.equal(round.answers[0]!.answers[0], "Tabs");
});

test("headless: no dialog, an honest answer, and details say so", async () => {
  const h = host();
  (h.ctx as { hasUI: boolean }).hasUI = false;
  const result = await h.ask({ questions: [q()] });
  assert.equal((result.details as { headless: boolean }).headless, true);
  // No select was ever attempted — a headless run must not hang on a dialog.
  assert.equal(h.selectLog.length, 0);
});

test("invalid questions are rejected before any dialog opens", async () => {
  const h = host();
  await assert.rejects(() => h.ask({ questions: [] }));
  assert.equal(h.selectLog.length, 0);
});
