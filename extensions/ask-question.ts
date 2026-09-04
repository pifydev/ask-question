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
  DONE_LABEL,
  OTHER_LABEL,
  formatAnswers,
  labelFromDisplay,
  optionDisplay,
  parseToggleRow,
  toggleRows,
  validateQuestions,
  type AskAnswer,
  type AskQuestion,
} from "../src/ask.ts";

type UiContext = ExtensionContext;

export default function askQuestion(pi: ExtensionAPI) {
  async function askSingle(ctx: UiContext, q: AskQuestion): Promise<AskAnswer> {
    const rows = [...q.options.map(optionDisplay), ...(q.allowOther ? [OTHER_LABEL] : [])];
    const picked = await ctx.ui.select(q.question, rows);
    if (picked === undefined) return { question: q.question, answers: [], declined: true };
    if (picked === OTHER_LABEL) {
      const text = await ctx.ui.input(q.question, "Type your answer");
      if (text === undefined || !text.trim()) {
        return { question: q.question, answers: [], declined: true };
      }
      return { question: q.question, answers: [], other: text.trim() };
    }
    const label = labelFromDisplay(picked, q.options);
    return { question: q.question, answers: label ? [label] : [] };
  }

  async function askMulti(ctx: UiContext, q: AskQuestion): Promise<AskAnswer> {
    const selected = new Set<number>();
    let other: string | undefined;
    for (;;) {
      const picked = await ctx.ui.select(
        `${q.question}\n(toggle options, then ${DONE_LABEL})`,
        toggleRows(q.options, selected, q.allowOther),
      );
      if (picked === undefined) return { question: q.question, answers: [], declined: true };
      const action = parseToggleRow(picked, q.options);
      if (!action) continue;
      if (action.kind === "done") break;
      if (action.kind === "other") {
        const text = await ctx.ui.input(q.question, "Type your answer");
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
          options: Type.Optional(
            Type.Array(
              Type.Object({
                label: Type.String({ description: "Concise choice (1-6 words)" }),
                description: Type.Optional(Type.String({ description: "Trade-offs of this choice" })),
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
    async execute(_id, params: { questions: unknown }, _signal, _onUpdate, ctx) {
      const uiCtx = ctx as UiContext;
      const result = validateQuestions(params.questions);
      if (result.error) throw new Error(result.error);

      if (!uiCtx.hasUI) {
        return {
          content: [
            {
              type: "text",
              text: "No UI is available to ask the user. Proceed with your best judgment and clearly state the assumption you made.",
            },
          ],
          details: { headless: true },
        };
      }

      const answers: AskAnswer[] = [];
      for (const q of result.questions) {
        const answer = q.multiSelect ? await askMulti(uiCtx, q) : await askSingle(uiCtx, q);
        answers.push(answer);
        if (answer.declined) {
          // Esc aborts the rest — the user is opting out of the questionnaire.
          for (const rest of result.questions.slice(answers.length)) {
            answers.push({ question: rest.question, answers: [], declined: true });
          }
          break;
        }
      }

      const text = [
        formatAnswers(answers),
        ...(result.warnings.length > 0 ? [`Warnings: ${result.warnings.join("; ")}`] : []),
      ].join("\n\n");
      return { content: [{ type: "text", text }], details: { answers } };
    },
  });
}
