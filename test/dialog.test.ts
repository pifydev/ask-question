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
      signal: AbortSignal | undefined,
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
  const selectLog: Array<{ title: string; rows: string[]; signal?: AbortSignal }> = [];
  const inputLog: Array<{ signal?: AbortSignal }> = [];
  const controller = new AbortController();
  const ctx = {
    hasUI: true,
    ui: {
      async select(title: string, rows: string[], opts?: { signal?: AbortSignal }) {
        selectLog.push({ title, rows, signal: opts?.signal });
        // Mirror pi: an already-aborted signal resolves the dialog to undefined
        // without ever showing it, so a scripted step is not consumed.
        if (opts?.signal?.aborted) return undefined;
        const step = selects.shift();
        if (!step) throw new Error(`unscripted select: ${title}`);
        return step(title, rows);
      },
      async input(_title: string, _placeholder: string, opts?: { signal?: AbortSignal }) {
        inputLog.push({ signal: opts?.signal });
        if (opts?.signal?.aborted) return undefined;
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
    inputLog,
    ctx,
    controller,
    ask: (params: unknown, signal: AbortSignal | undefined = controller.signal) =>
      tool!.execute("t1", params, signal, undefined, ctx),
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

test("Other then Esc returns to the select, does not decline the batch", async () => {
  const h = host();
  // Pick Other…, back out of the free-text box (Esc → undefined), land back
  // on the option list, then pick Tabs. The mis-click must not throw the
  // question away.
  h.selects.push(pickRow(OTHER_LABEL), pickRow("Tabs"));
  h.inputs.push(undefined);
  const result = await h.ask({ questions: [q()] });
  const answer = (result.details as { answers: Array<{ answers: string[]; declined?: boolean }> }).answers[0]!;
  assert.deepEqual(answer.answers, ["Tabs"]);
  assert.notEqual(answer.declined, true);
  // Two visits to the select: the one before Other, the one after backing out.
  assert.equal(h.selectLog.length, 2);
});

test("the AbortSignal is forwarded to ui.select and ui.input", async () => {
  const h = host();
  h.selects.push(pickRow(OTHER_LABEL));
  h.inputs.push("free text");
  await h.ask({ questions: [q()] });
  assert.equal(h.selectLog[0]!.signal, h.controller.signal);
  assert.equal(h.inputLog[0]!.signal, h.controller.signal);
});

test("an aborted dialog is reported as interrupted, not declined, and not recorded", async () => {
  const h = host();
  // The dialog is aborted while on screen (the way pi's abort resolves it):
  // the controller fires and the select returns undefined.
  h.selects.push(() => {
    h.controller.abort();
    return undefined;
  });
  const result = await h.ask({ questions: [q()] });
  assert.equal((result.details as { aborted?: boolean }).aborted, true);
  assert.match(result.content[0]!.text, /Interrupted/i);
  assert.doesNotMatch(result.content[0]!.text, /declined/i);
  // An interruption is not a decision: nothing lands in the session record.
  assert.equal(h.appended.length, 0);
});

test("an abort before the second question stops the loop and records nothing", async () => {
  const h = host();
  h.selects.push((_title, rows) => {
    // Answer question 1, but the turn is aborted in the same beat — question 2
    // must never be shown and the round must not be recorded.
    h.controller.abort();
    return rows.find((r) => r.includes("Tabs"))!;
  });
  const result = await h.ask({
    questions: [q(), { question: "Semicolons?", options: [{ label: "Yes" }, { label: "No" }] }],
  });
  assert.equal((result.details as { aborted?: boolean }).aborted, true);
  assert.equal(h.selectLog.length, 1);
  assert.equal(h.appended.length, 0);
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

test("Back revises the previous answer; the row is offered from the second question on", async () => {
  const h = host();
  const q2 = { question: "Semicolons?", options: [{ label: "Yes" }, { label: "No" }] };
  h.selects.push(pickRow("Tabs")); // q1
  h.selects.push(pickRow("Back")); // q2: go back
  h.selects.push(pickRow("Spaces")); // q1 again, revised
  h.selects.push(pickRow("Yes")); // q2
  const result = await h.ask({ questions: [q(), q2] });
  const answers = (result.details as { answers: Array<{ answers: string[] }> }).answers;
  assert.deepEqual(answers.map((a) => a.answers), [["Spaces"], ["Yes"]]);
  assert.ok(!h.selectLog[0]!.rows.some((r) => r.includes("Back")), "no Back on the first question");
  assert.ok(h.selectLog[1]!.rows.some((r) => r.includes("Back")), "Back offered on the second");
  assert.equal(h.selectLog.length, 4);
  // One record, holding the revised answers.
  assert.equal(h.appended.length, 1);
});

test("Back works on a multi-select question too, and Esc still declines the rest", async () => {
  const h = host();
  const q2 = { question: "Which?", options: [{ label: "A" }, { label: "B" }], multiSelect: true };
  h.selects.push(pickRow("Tabs")); // q1
  h.selects.push(pickRow("Back")); // q2 (multi): back
  h.selects.push(esc); // q1 again: decline everything
  const result = await h.ask({ questions: [q(), q2] });
  const answers = (result.details as { answers: Array<{ declined?: boolean }> }).answers;
  assert.equal(answers.length, 2);
  assert.ok(answers.every((a) => a.declined));
});
