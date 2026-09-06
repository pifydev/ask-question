# @pify/ask-question

Let the model ask instead of guessing — a Claude Code `AskUserQuestion`-shaped tool for [pi](https://github.com/earendil-works/pi): 1-4 structured questions, written-out options with trade-offs, multi-select, and an "Other…" free-text path.

Part of the [Pify suite](https://github.com/pifydev). Install with [`pify install ask-question`](https://github.com/pifydev/cli) or `pi install npm:@pify/ask-question`.

## What it does

- **`ask_question`** — the agent batches up to 4 questions, each with up to 4 options (`label` + `description` trade-offs, recommendation marked "(Recommended)" and listed first), optional `multiSelect`, and free-text via "Other…".
- **Built entirely on pi's built-in dialogs** (`select`/`input`) — no custom TUI overlay, so it works identically in the terminal and RPC/GUI hosts and can't break with pi UI changes. Multi-select is a checkbox toggle loop with `✓ Done`.
- **Discipline encoded in the tool description** (zhushanwen's three conditions): only when 2+ reasonable approaches exist, context is already gathered, and a wrong pick means rework. Never for permissions or things the agent can look up.
- **Declining is an answer**: Esc cleanly reports "the user declined" for the rest of the batch — no error, no re-asking. Headless runs get the full questionnaire back — every question with its options — plus "proceed with your best judgment and say which option you assumed", so the decision stays in the CI transcript instead of vanishing (asking is advisory, unlike the fail-closed safety gates).
- **The decisions stay on the record** (v0.3): every questionnaire is appended to the session as its own entry, and `/ask` prints the last one (`/ask all` for the whole history) with what you chose or declined. Forks and `/reload` keep their own history, because the entries live on the branch.
- **Rows the user can actually pick** (v0.2): two options sharing a label, or one labelled `Other…`, used to render as indistinguishable rows where the second was unselectable. Duplicates are now suffixed, reserved labels renamed, and every pick resolves by its position in the dialog rather than by its text.
- Structured results return to the model as both readable text and `details.answers`.

## Why no fancy overlay?

The three big prior arts (6-16k lines each) all build custom TUI overlays — tabbed questionnaires, split-pane previews, searchable lists. They're impressive and fragile. `@henryqw/pi-ask-question` proved 256 lines of built-in dialogs covers the core; this package takes that floor and adds the CC schema, multi-select, and discipline. The overlay experience can return as v0.2 if demand appears.

## License

MIT © [Pify maintainers](https://github.com/pifydev)
