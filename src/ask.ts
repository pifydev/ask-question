/**
 * Pure logic for @pify/ask-question.
 * No imports from pi packages; fully unit-testable.
 */

export interface AskOption {
  label: string;
  description?: string;
}

export interface AskQuestion {
  question: string;
  options: AskOption[];
  multiSelect: boolean;
  allowOther: boolean;
}

export interface AskAnswer {
  question: string;
  /** Selected option labels (empty when only `other` was given). */
  answers: string[];
  /** Free-text answer via "Other…", when used. */
  other?: string;
  declined?: boolean;
}

export const MAX_QUESTIONS = 4;
export const MAX_OPTIONS = 4;
export const OTHER_LABEL = "Other…";
export const DONE_LABEL = "✓ Done";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ValidationResult {
  questions: AskQuestion[];
  warnings: string[];
  error: string | null;
}

export function validateQuestions(raw: unknown): ValidationResult {
  const warnings: string[] = [];
  if (!Array.isArray(raw) || raw.length === 0) {
    return { questions: [], warnings, error: "questions must be a non-empty array" };
  }
  if (raw.length > MAX_QUESTIONS) warnings.push(`capped at ${MAX_QUESTIONS} questions`);

  const questions: AskQuestion[] = [];
  for (const entry of raw.slice(0, MAX_QUESTIONS)) {
    if (!isRecord(entry) || typeof entry.question !== "string" || !entry.question.trim()) {
      warnings.push("dropped a question without text");
      continue;
    }
    const options: AskOption[] = [];
    if (Array.isArray(entry.options)) {
      for (const opt of entry.options.slice(0, MAX_OPTIONS)) {
        if (isRecord(opt) && typeof opt.label === "string" && opt.label.trim()) {
          options.push({
            label: opt.label.trim(),
            ...(typeof opt.description === "string" && opt.description.trim()
              ? { description: opt.description.trim() }
              : {}),
          });
        } else {
          warnings.push("dropped an option without a label");
        }
      }
      if (entry.options.length > MAX_OPTIONS) {
        warnings.push(`options capped at ${MAX_OPTIONS} per question`);
      }
    }
    const allowOther = entry.allowOther !== false;
    if (options.length === 0 && !allowOther) {
      warnings.push(`question "${entry.question.slice(0, 30)}" has no options and allowOther=false — dropped`);
      continue;
    }
    const normalized = normalizeOptions(options);
    warnings.push(...normalized.warnings);
    questions.push({
      question: entry.question.trim(),
      options: normalized.options,
      multiSelect: entry.multiSelect === true,
      allowOther,
    });
  }

  if (questions.length === 0) {
    return { questions, warnings, error: "no valid questions remained" };
  }
  return { questions, warnings, error: null };
}

/**
 * Make every option in a question distinguishable in the dialog. Two options
 * sharing a label render as identical rows (the second is then unselectable),
 * and an option labelled like a control row steals that row's meaning — both
 * are the model's doing, so they are repaired rather than rejected.
 */
export function normalizeOptions(options: AskOption[]): { options: AskOption[]; warnings: string[] } {
  const warnings: string[] = [];
  const seen = new Map<string, number>();
  const result: AskOption[] = [];
  for (const option of options) {
    let label = option.label;
    if (label === OTHER_LABEL || label === DONE_LABEL) {
      label = `${label} (option)`;
      warnings.push(`renamed an option labelled "${option.label}" — that label is reserved`);
    }
    const count = seen.get(label) ?? 0;
    seen.set(label, count + 1);
    if (count > 0) {
      const unique = `${label} (${count + 1})`;
      warnings.push(`renamed a duplicate option label "${label}"`);
      label = unique;
    }
    result.push({ ...option, label });
  }
  return { options: result, warnings };
}

/** Display string for one option in the select dialog. */
export function optionDisplay(option: AskOption): string {
  const desc = option.description
    ? ` — ${option.description.length > 60 ? `${option.description.slice(0, 60)}…` : option.description}`
    : "";
  return `${option.label}${desc}`;
}

/** Rows for a single-select question: the options, then Other… if allowed. */
export function singleRows(options: AskOption[], allowOther: boolean): string[] {
  const rows = options.map(optionDisplay);
  if (allowOther) rows.push(OTHER_LABEL);
  return rows;
}

export type SingleAction = { kind: "option"; index: number } | { kind: "other" };

/**
 * Resolve a pick by its position in the rows that were shown. Matching on the
 * display string instead would confuse an option with the control row that
 * happens to read the same.
 */
export function parseSingleRow(picked: string, rows: string[], options: AskOption[]): SingleAction | null {
  const index = rows.indexOf(picked);
  if (index < 0) return null;
  return index < options.length ? { kind: "option", index } : { kind: "other" };
}

/** Rows for one round of the multi-select toggle loop. */
export function toggleRows(options: AskOption[], selected: ReadonlySet<number>, allowOther: boolean): string[] {
  const rows = options.map((o, i) => `[${selected.has(i) ? "x" : " "}] ${optionDisplay(o)}`);
  rows.push(DONE_LABEL);
  if (allowOther) rows.push(OTHER_LABEL);
  return rows;
}

export type ToggleAction = { kind: "toggle"; index: number } | { kind: "done" } | { kind: "other" };

export function parseToggleRow(row: string, rows: string[], options: AskOption[]): ToggleAction | null {
  const index = rows.indexOf(row);
  if (index < 0) return null;
  if (index < options.length) return { kind: "toggle", index };
  return index === options.length ? { kind: "done" } : { kind: "other" };
}

/**
 * What the model gets back when there is nobody to ask (RPC, CI, headless).
 * Replaying the questions and options keeps the decision in the transcript,
 * so the assumption it states can be checked against what it offered.
 */
export function headlessText(questions: AskQuestion[]): string {
  const blocks = questions.map((q) => {
    const options = q.options.map((o) => `  - ${optionDisplay(o)}`);
    if (q.allowOther) options.push("  - (free text)");
    return [`Q: ${q.question}`, ...options].join("\n");
  });
  return [
    "No UI is available to ask the user. These are the questions you would have asked:",
    "",
    blocks.join("\n\n"),
    "",
    "Proceed with your best judgment, and say plainly which option you assumed and why.",
  ].join("\n");
}

/** Text block the model receives. */
export function formatAnswers(answers: AskAnswer[]): string {
  return answers
    .map((a) => {
      if (a.declined) return `Q: ${a.question}\nA: (the user declined to answer)`;
      const parts = [...a.answers];
      if (a.other) parts.push(`Other: ${a.other}`);
      return `Q: ${a.question}\nA: ${parts.length > 0 ? parts.join("; ") : "(no selection)"}`;
    })
    .join("\n\n");
}
