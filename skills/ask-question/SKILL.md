---
name: ask-question
description: Use when a decision is genuinely ambiguous after gathering context and picking wrong means rework
---

# Asking the user

This project has the `@pify/ask-question` extension installed: `ask_question`
presents 1-4 structured questions through pi's dialogs.

## The three conditions (all must hold)

1. The request has 2+ reasonable approaches.
2. You already gathered context (read/grep) and it is STILL ambiguous.
3. Picking wrong means redoing real work.

If any fails: don't ask. Look it up, or pick the obvious option and say so.

## Never use it for

- Permissions or approvals (safety gates own that).
- Facts you can verify in the codebase yourself.
- Confirming a plan you are confident in ("shall I proceed?").
- More than one call per decision point — batch related questions (max 4).

## Writing good questions

- Complete question ending with "?"; options are concise (1-6 words) with
  trade-offs in descriptions.
- Put your recommendation FIRST and append " (Recommended)" to its label.
- Use multiSelect only when choices are not mutually exclusive.
- Leave allowOther on unless free text makes no sense.

## Respecting answers

- A declined answer (Esc) is an answer: proceed on your best judgment,
  state the assumption, and do not re-ask.
- With no UI (headless), the tool tells you to proceed — do that, and make
  the assumption explicit in your reply.
