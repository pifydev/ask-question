/**
 * @pify/ask-question — let the model ask instead of guessing.
 *
 * One tool, Claude Code AskUserQuestion-shaped: 1-4 questions with up to 4
 * written-out options each, multi-select, and an "Other…" free-text path.
 * Built ENTIRELY on pi's built-in dialogs (ui.select / ui.input) — no custom
 * TUI overlay, so it works identically in the terminal and in RPC/GUI hosts
 * and cannot break with pi UI changes (HenryQW's floor, deliberately chosen
 * over the 6-16k-line overlay implementations).
 *
 * Asking is advisory, not a gate: declining is a clean answer, and headless
 * runs get "proceed with your best judgment" instead of an error.
 *
 * Design synthesis: calling discipline (@zhushanwen/pi-ask-user), 4-question
 * batching + recommended convention (rpiv-ask-user-question, Claude Code),
 * multi-select (edlsh/pi-ask-user), built-in-dialog minimalism
 * (@henryqw/pi-ask-question).
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  ASK_STATE,
  DONE_LABEL,
  ENVELOPE_SUFFIX,
  OTHER_LABEL,
  formatAnswers,
  headlessText,
  parseAskRoute,
  parseSingleRow,
  parseToggleRow,
  questionTitle,
  replayRounds,
  routeText,
  singleRows,
  toggleRows,
  validateQuestions,
  type AskAnswer,
  type AskQuestion,
} from "../src/ask.ts";
import { withUiLock } from "../src/ui-lock.ts";

type UiContext = ExtensionContext;

export default function askQuestion(pi: ExtensionAPI) {
  async function askSingle(ctx: UiContext, q: AskQuestion, signal?: AbortSignal): Promise<AskAnswer> {
    // One question is one dialog session; the whole thing (including the
    // Other free-text follow-up) holds the suite-wide lock so no other
    // extension's dialog can open on top of it and orphan this promise.
    return withUiLock(() => askSingleLocked(ctx, q, signal));
  }

  async function askSingleLocked(ctx: UiContext, q: AskQuestion, signal?: AbortSignal): Promise<AskAnswer> {
    const rows = singleRows(q.options, q.allowOther);
    const title = questionTitle(q);
    // A loop, matching multi-select: only Esc on the SELECT is the batch-level
    // decline. Backing out of the Other free-text box (Esc or an empty submit)
    // returns to the option list — a mis-click on Other must not throw away
    // the rest of the questionnaire.
    for (;;) {
      const picked = await ctx.ui.select(title, rows, { signal });
      if (picked === undefined) return { question: q.question, answers: [], declined: true };
      const action = parseSingleRow(picked, rows, q.options);
      if (!action) continue;
      if (action.kind === "other") {
        const text = await ctx.ui.input(title, "Type your answer", { signal });
        if (!text?.trim()) continue;
        return { question: q.question, answers: [], other: text.trim() };
      }
      return { question: q.question, answers: [q.options[action.index]!.label] };
    }
  }

  async function askMulti(ctx: UiContext, q: AskQuestion, signal?: AbortSignal): Promise<AskAnswer> {
    // The toggle loop stays atomic under the lock — a background dialog must
    // not interleave between two toggles.
    return withUiLock(() => askMultiLocked(ctx, q, signal));
  }

  async function askMultiLocked(ctx: UiContext, q: AskQuestion, signal?: AbortSignal): Promise<AskAnswer> {
    const selected = new Set<number>();
    let other: string | undefined;
    const title = questionTitle(q);
    for (;;) {
      const rows = toggleRows(q.options, selected, q.allowOther);
      const picked = await ctx.ui.select(`${title}\n(toggle options, then ${DONE_LABEL})`, rows, { signal });
      if (picked === undefined) return { question: q.question, answers: [], declined: true };
      const action = parseToggleRow(picked, rows, q.options);
      if (!action) continue;
      if (action.kind === "done") break;
      if (action.kind === "other") {
        const text = await ctx.ui.input(title, "Type your answer", { signal });
        if (text?.trim()) other = text.trim();
        continue;
      }
      if (selected.has(action.index)) selected.delete(action.index);
      else selected.add(action.index);
    }
    return {
      question: q.question,
      answers: [...selected].sort((a, b) => a - b).map((i) => q.options[i]!.label),
      ...(other ? { other } : {}),
    };
  }

  pi.registerTool({
    name: "ask_question",
    label: "Ask the user",
    // Run alone, never in a parallel batch: the model otherwise dispatches
    // ask_question alongside a bash/edit/write in the same step, and those
    // side effects execute while the user is still being asked — the answer
    // then can't change what already happened. withUiLock only serializes
    // dialogs; this serializes the tool against everything else. (edlsh 0.11.2)
    executionMode: "sequential",
    promptSnippet: "Ask the user a question with preset options, when a choice is theirs to make",
    promptGuidelines: [
      "Batch every question a decision needs into ONE ask_question call (up to 4), not several calls back-to-back.",
      "Give each question 2-4 written-out options with a short description of each option's trade-off (≤ 60 chars — longer is clipped in the dialog); mark the option you would pick with ' (Recommended)' appended to its label and list it first.",
      "Set multiSelect only when several options can genuinely be combined; give each question a short header (≤16 chars) when more than one fires at once.",
      "Do NOT use it for permissions, for anything you can look up yourself, or to confirm a plan you are already confident in — a declined answer is a real answer, so respect it and proceed.",
    ],
    description:
      "Ask the user 1-4 structured questions, each with up to 4 written-out options (mark your " +
      "recommendation by appending ' (Recommended)' to its label and putting it first), optional " +
      "multiSelect, and an Other free-text path (allowOther, default true). " +
      "Call ONLY when all three hold: the request has 2+ reasonable approaches; you have already " +
      "gathered context (read/grep) and it is still genuinely ambiguous; and picking wrong means " +
      "redoing real work. Never use it for permissions, for things you can look up yourself, or to " +
      "confirm a plan you are confident in. A declined answer is an answer — respect it and proceed.",
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          question: Type.String({ description: "The complete question, ending with a question mark" }),
          header: Type.Optional(
            Type.String({ description: "Optional short label (≤16 chars) shown as a chip before the question, e.g. \"Auth method\"" }),
          ),
          options: Type.Optional(
            Type.Array(
              Type.Object({
                label: Type.String({ description: "Concise choice (1-6 words)" }),
                description: Type.Optional(Type.String({ description: "Trade-off of this choice; ≤ 60 chars are shown, longer is clipped in the dialog" })),
              }),
              { maxItems: 4 },
            ),
          ),
          multiSelect: Type.Optional(Type.Boolean({ description: "Allow selecting several options" })),
          allowOther: Type.Optional(Type.Boolean({ description: "Offer a free-text Other path (default true)" })),
        }),
        { minItems: 1, maxItems: 4 },
      ),
    }),
    async execute(_id, params: { questions: unknown }, signal, _onUpdate, ctx) {
      const uiCtx = ctx as UiContext;
      const result = validateQuestions(params.questions);
      if (result.error) throw new Error(result.error);

      if (!uiCtx.hasUI) {
        return {
          content: [{ type: "text", text: headlessText(result.questions) }],
          details: { headless: true, questions: result.questions },
        };
      }

      // An abort (RPC-client "abort", a third-party extension's ctx.abort())
      // is not a decline: it means nobody answered. pi resolves the open
      // select/input to undefined once the signal is forwarded, which would
      // otherwise look identical to Esc, so we check the signal directly and
      // report an interruption — never recording it or telling the model the
      // user "declined" a decision they never saw.
      const interrupted = () => ({
        content: [
          {
            type: "text" as const,
            text: "Interrupted before the user answered; ask again if the decision is still needed.",
          },
        ],
        details: { aborted: true, answers },
      });

      const answers: AskAnswer[] = [];
      for (const q of result.questions) {
        if (signal?.aborted) return interrupted();
        const answer = q.multiSelect ? await askMulti(uiCtx, q, signal) : await askSingle(uiCtx, q, signal);
        if (signal?.aborted) return interrupted();
        answers.push(answer);
        if (answer.declined) {
          // Esc aborts the rest — the user is opting out of the questionnaire.
          for (const rest of result.questions.slice(answers.length)) {
            answers.push({ question: rest.question, answers: [], declined: true });
          }
          break;
        }
      }
      if (signal?.aborted) return interrupted();

      // Record the round so /ask can show it later, and a fork keeps its own
      // history; appended per round, never overwritten.
      pi.appendEntry(ASK_STATE, { timestamp: Date.now(), answers });

      const declinedAll = answers.every((a) => a.declined);
      const text = [
        formatAnswers(answers),
        ...(result.warnings.length > 0 ? [`Warnings: ${result.warnings.join("; ")}`] : []),
        // Nudge the model to act on the answers — unless every question was
        // declined, where "proceed with your judgment" is the honest close.
        declinedAll ? "The user declined; proceed with your best judgment." : ENVELOPE_SUFFIX,
      ].join("\n\n");
      return { content: [{ type: "text", text }], details: { answers } };
    },
  });

  pi.registerCommand("ask", {
    description: "Show what the agent asked you and how you answered: /ask [last | all]",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      const rounds = replayRounds(ctx.sessionManager.getBranch() as never);
      ctx.ui.notify(routeText(parseAskRoute(args ?? ""), rounds), "info");
    },
  });
}
