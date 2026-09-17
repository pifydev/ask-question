# @pify/ask-question

[![CI](https://github.com/pifydev/ask-question/actions/workflows/ci.yml/badge.svg)](https://github.com/pifydev/ask-question/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/@pify/ask-question)](https://www.npmjs.com/package/@pify/ask-question) [![npm downloads](https://img.shields.io/npm/dm/@pify/ask-question)](https://www.npmjs.com/package/@pify/ask-question)

Let the model ask instead of guessing — a structured question tool for [pi](https://github.com/earendil-works/pi). Up to four questions per batch, written-out options with their trade-offs, multi-select, and a free-text path for the answer you didn't offer.

Part of the [Pify suite](https://github.com/pifydev). Install with [`pify install ask-question`](https://github.com/pifydev/cli) or `pi install npm:@pify/ask-question`.

## Why

An agent that will not ask has only one way to handle ambiguity: pick something and keep going. That is fine when the choices are equivalent and expensive when they are not — the wrong guess is discovered after the work has been built on top of it. The cost of asking is one dialog; the cost of guessing wrong is the rework.

The opposite failure is just as real. An agent that asks about everything turns delegation into an interview, and the questions it asks are usually ones it could have answered by reading a file. So the tool's description spends most of its words on when *not* to use it.

## The tool

### `ask_question`

| Parameter | Type | Notes |
|---|---|---|
| `questions` | array, 1–4 | Asked in order, each as its own dialog |
| `questions[].question` | string | The complete question, ending in a question mark |
| `questions[].header` | string, optional | A short chip (≤16 chars) shown before the question, e.g. `[Auth method]` — handy when several fire at once |
| `questions[].options` | array, up to 4 | Omit for a pure free-text prompt |
| `questions[].options[].label` | string | The choice itself, 1–6 words |
| `questions[].options[].description` | string, optional | What this choice costs or implies (≤ 60 chars are shown in the dialog; longer is clipped) |
| `questions[].multiSelect` | boolean, optional | Checkbox toggles ending in `✓ Done`, instead of a single pick |
| `questions[].allowOther` | boolean, optional | Free-text `Other…` path; on by default |

A recommendation is expressed by marking the label `(Recommended)` and listing it first.

Answers return both as readable text and as `details.answers`, so anything reading the tool result does not have to parse prose.

### When it should fire

The tool description holds the agent to three conditions at once:

- two or more reasonable approaches genuinely exist,
- the context needed to choose has already been gathered,
- and picking wrong means rework rather than a small correction.

It is explicitly not for permission ("shall I edit this file?") and not for anything the agent could look up.

## Behaviour

- **Built on pi's own dialogs.** `select` and `input`, nothing custom. It therefore behaves identically in the terminal and in RPC or GUI hosts, and cannot break when pi's UI changes. Multi-select is a toggle loop over the same primitive.
- **Declining is an answer.** Esc on a question's option list reports *the user declined* for that question and the rest of the batch — no error, no re-asking, no second dialog fighting for your attention. Backing out of the free-text `Other…` box (Esc or an empty submit) is not a decline: it returns you to the option list, so a mis-click on `Other…` never throws the questionnaire away.
- **An interruption is not a decline.** If the turn is aborted while a question is open (an RPC-client abort, another extension calling `abort()`), the tool reports *interrupted before the user answered* and records nothing — the model is told to ask again if the decision still matters, rather than reading a decline the user never made.
- **Headless runs get the questionnaire back.** With no UI available the tool returns every question and option as text, plus an instruction to proceed on best judgment and say which option was assumed. The decision then lives in the CI transcript instead of vanishing. Asking is advisory, unlike this suite's fail-closed safety gates: a question that cannot be asked must never stop the run.
- **Rows you can actually pick.** Two options sharing a label, or one already called `Other…`, used to render as indistinguishable rows where the second could not be selected. Duplicates are suffixed, reserved labels renamed, and every answer resolves by its position in the dialog rather than by its text.
- **The decisions stay on the record.** Every questionnaire is appended to the session as its own entry. Forks and `/reload` keep their own history, because the entries live on the branch rather than in memory.
- **All of the above is exercised, not asserted.** The dialog flow lives entirely behind `ctx.ui.select` / `ctx.ui.input`, so `test/dialog.test.ts` drives the real shipped `execute` through a stub host with scripted answers: single select, the Other free-text path, multi-select toggling on and off, Esc declining the remaining batch without showing it, the headless branch never opening a dialog, and the round landing in the session entry. What the stub cannot vouch for is pi's own dialog rendering — that is pi's contract, not this package's.

## Command

`/ask` — show the last questionnaire and what you chose or declined. `/ask all` prints the whole history for this branch.

## Design notes

There is no custom TUI overlay, and that is deliberate. An overlay means owning a rendering surface: it has to be re-tested against every pi UI change, it does not exist at all in RPC and GUI hosts, and it fails in the one place a question matters most — when something has already gone sideways. Built-in dialogs work everywhere pi works.

## Where this sits in the suite

This is the question a *top-level* agent asks you. A child agent spawned by [`@pify/subagent`](https://github.com/pifydev/subagent) reaches you through its own `ask_supervisor` tool instead, because the parent is blocked inside the tool call that spawned the child and could not answer anyway.

## License

MIT © [Pify maintainers](https://github.com/pifydev)
