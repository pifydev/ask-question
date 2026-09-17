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
  /** Optional short chip shown before the question when several fire in a turn. */
  header?: string;
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
export const MAX_HEADER = 16;
export const OTHER_LABEL = "Other…";
export const DONE_LABEL = "✓ Done";

/**
 * A closing line appended to the answers the model receives (not to the /ask
 * history). It nudges the model to act on the answers rather than re-ask or
 * stall — the small "you have the answer now, proceed" push arhen's envelope
 * carries. Kept terse to avoid transcript bloat.
 */
export const ENVELOPE_SUFFIX = "You have the user's answers — continue with them in mind; do not ask these again.";

/** The dialog title for a question: an optional chip, then the question. */
export function questionTitle(q: AskQuestion): string {
  return q.header ? `[${q.header}] ${q.question}` : q.question;
}

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
    const header =
      typeof entry.header === "string" && entry.header.trim()
        ? entry.header.trim().slice(0, MAX_HEADER)
        : undefined;
    questions.push({
      question: entry.question.trim(),
      options: normalized.options,
      multiSelect: entry.multiSelect === true,
      allowOther,
      ...(header ? { header } : {}),
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

export const DESC_CLIP = 60;

/**
 * Display string for one option. In the select dialog the description is
 * clipped to keep the row on one line (`clip`, the default); the headless
 * replay passes `clip: false` because there is no row width to protect there
 * and the transcript should carry the model's full trade-off, not a stub.
 */
export function optionDisplay(option: AskOption, clip = true): string {
  const desc = option.description
    ? ` — ${clip && option.description.length > DESC_CLIP ? `${option.description.slice(0, DESC_CLIP)}…` : option.description}`
    : "";
  return `${option.label}${desc}`;
}

/** Rows for a single-select question: the options, then Other… if allowed. */
export function singleRows(options: AskOption[], allowOther: boolean): string[] {
  const rows = options.map((o) => optionDisplay(o));
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
    const options = q.options.map((o) => `  - ${optionDisplay(o, false)}`);
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

export const ASK_STATE = "ask-question-round";

export interface AskRound {
  timestamp: number;
  answers: AskAnswer[];
}

export interface BranchEntryLike {
  type?: string;
  customType?: string;
  data?: unknown;
  [key: string]: unknown;
}

/**
 * Every questionnaire is appended as its own entry (not a last-wins
 * snapshot): the point of the record is the sequence of decisions, and an
 * earlier answer stays true after a later one is given.
 */
export function replayRounds(entries: BranchEntryLike[]): AskRound[] {
  const rounds: AskRound[] = [];
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== ASK_STATE) continue;
    const data = entry.data;
    if (!isRecord(data) || !Array.isArray(data.answers)) continue;
    rounds.push({
      timestamp: typeof data.timestamp === "number" ? data.timestamp : 0,
      answers: data.answers as AskAnswer[],
    });
  }
  return rounds;
}

export type AskRoute = { kind: "last" } | { kind: "all" } | { kind: "help" } | { kind: "unknown"; input: string };

export const ASK_USAGE = "Usage: /ask [last | all]";

export function parseAskRoute(raw: string): AskRoute {
  const text = (raw ?? "").trim().toLowerCase();
  if (!text || text === "last") return { kind: "last" };
  if (text === "all" || text === "history") return { kind: "all" };
  if (text === "help" || text === "?") return { kind: "help" };
  return { kind: "unknown", input: text };
}

function stamp(timestamp: number): string {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())} `;
}

/** What /ask prints. */
export function routeText(route: AskRoute, rounds: AskRound[]): string {
  switch (route.kind) {
    case "help":
      return ASK_USAGE;
    case "unknown":
      return `Unknown route "${route.input}". ${ASK_USAGE}`;
    case "last": {
      const last = rounds[rounds.length - 1];
      return last
        ? `${stamp(last.timestamp)}last questionnaire\n${formatAnswers(last.answers)}`
        : "No questions have been asked in this session.";
    }
    case "all":
      return rounds.length === 0
        ? "No questions have been asked in this session."
        : rounds
            .map((round, i) => `#${i + 1} ${stamp(round.timestamp)}\n${formatAnswers(round.answers)}`)
            .join("\n\n");
  }
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
