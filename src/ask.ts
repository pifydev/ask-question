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
    questions.push({
      question: entry.question.trim(),
      options,
      multiSelect: entry.multiSelect === true,
      allowOther,
    });
  }

  if (questions.length === 0) {
    return { questions, warnings, error: "no valid questions remained" };
  }
  return { questions, warnings, error: null };
}

/** Display string for one option in the select dialog. */
export function optionDisplay(option: AskOption): string {
  const desc = option.description
    ? ` — ${option.description.length > 60 ? `${option.description.slice(0, 60)}…` : option.description}`
    : "";
  return `${option.label}${desc}`;
}

/** Map a picked display string back to its option label. */
export function labelFromDisplay(display: string, options: AskOption[]): string | null {
  const found = options.find((o) => optionDisplay(o) === display);
  return found ? found.label : null;
}

/** Rows for one round of the multi-select toggle loop. */
export function toggleRows(options: AskOption[], selected: ReadonlySet<number>, allowOther: boolean): string[] {
  const rows = options.map((o, i) => `[${selected.has(i) ? "x" : " "}] ${optionDisplay(o)}`);
  rows.push(DONE_LABEL);
  if (allowOther) rows.push(OTHER_LABEL);
  return rows;
}

export type ToggleAction = { kind: "toggle"; index: number } | { kind: "done" } | { kind: "other" };

export function parseToggleRow(row: string, options: AskOption[]): ToggleAction | null {
  if (row === DONE_LABEL) return { kind: "done" };
  if (row === OTHER_LABEL) return { kind: "other" };
  const body = row.replace(/^\[[x ]\] /, "");
  const index = options.findIndex((o) => optionDisplay(o) === body);
  return index >= 0 ? { kind: "toggle", index } : null;
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
