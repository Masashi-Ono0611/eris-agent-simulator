// npm run inference-keys -- <responses.csv> --out <inference-keys.yaml> [--map <column-map.yaml>]
//                                           [--roster <field.yaml>] [--force] [--skip-invalid]
//
// The credential form's answers (a Google Forms CSV export) -> the inference proxy's `--keys` file
// (core/src/inference/proxy.ts `loadParticipantKeys`, infra/inference-proxy/README.md "Participant
// credentials"). Rules §2.5 / terms 第8条の2: the live week calls each participant's provider with
// the key that participant submitted, so this file is every participant's credential in one place.
//
// What it guarantees:
//   - no key value is ever printed. Reports carry counts, unit ids, providers and a masked form
//     (first 4 + last 2 characters, and only for keys long enough that this reveals nothing usable)
//   - the file is written mode 0600 (the proxy refuses anything wider) and never over an existing
//     one without --force
//   - what was written is read back and passed through loadParticipantKeys, so a file this tool
//     produced is a file the proxy starts with
//
// Rows: one per (unit, provider). A participant who answers again replaces their earlier answer for
// that provider -- the latest by the form's timestamp (row order when there is no timestamp column
// or two rows share one). A form that asks for several providers' keys in one row ("OpenAI API key",
// "Anthropic API key" columns) is read too: each such column is one (unit, provider) answer.
//
// Columns are found by their headers (see HEADER_PATTERNS) or named explicitly with --map:
//   timestamp: "タイムスタンプ"
//   unit: "参加単位の識別子"
//   provider: "推論サービス"
//   key: "API キー"
//   # or, for one key column per provider:
//   providerKeys: { openai: "OpenAI API key", anthropic: "Anthropic API key" }
import {
  chmodSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { loadParticipantKeys, type ParticipantKeys } from "../core/src/inference/proxy.js";

export type Provider = "ollama" | "openai" | "anthropic";
export const PROVIDERS: readonly Provider[] = ["ollama", "openai", "anthropic"];

// The roster id rule the submission path enforces (infra/submission/accept-submission.sh,
// scripts/agentSelftest.ts): the id becomes example/agents/<id>/ and the image tag eris-agent:<id>.
export const UNIT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
// Directory names under example/agents/ that are not agents (CLAUDE.md "エージェントの書き方").
const RESERVED_IDS = new Set(["runtime", "lib"]);

// --- CSV (RFC 4180: quoted fields, doubled quotes, CR/LF/CRLF, embedded newlines, a leading BOM) --

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("the CSV ends inside a quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// --- columns ---------------------------------------------------------------------------------------

export type ColumnMap = {
  timestamp?: string;
  unit: string;
  provider?: string;
  key?: string;
  providerKeys?: Partial<Record<Provider, string>>;
};

const KEY_RE = /api\s*[-_]?\s*key|\bkey\b|キー|鍵|credential|認証情報|token|トークン/i;
const TIMESTAMP_RE = /timestamp|タイムスタンプ|submitted\s*at|送信日時|回答日時/i;
// Ordered by how specific the word is: a form with "Team name" and "Handle" means the handle.
const UNIT_RES = [
  /識別子|ハンドル|handle|participant\s*id|unit\s*id|agent\s*id|roster\s*id/i,
  /参加単位|チーム|team|unit/i,
];
const PROVIDER_RE = /provider|プロバイダ|サービス|service|vendor/i;

// "OpenAI (GPT)", "Anthropic (Claude)", "Ollama Cloud" -> the proxy's provider name. An answer
// naming two providers (or none) is not guessed at.
export function normalizeProvider(text: string): Provider | undefined {
  const t = text.normalize("NFKC").toLowerCase();
  const hits = new Set<Provider>();
  if (/anthropic|claude|アンソロピック|クロード/.test(t)) hits.add("anthropic");
  if (/openai|open\s+ai|chatgpt|\bgpt/.test(t)) hits.add("openai");
  if (/ollama|オラマ/.test(t)) hits.add("ollama");
  return hits.size === 1 ? [...hits][0] : undefined;
}

const quoteList = (hs: string[]) => hs.map((h) => JSON.stringify(h)).join(", ");

function unique(headers: string[], pred: (h: string) => boolean, role: string): string | undefined {
  const found = headers.filter(pred);
  if (found.length > 1)
    throw new Error(`more than one column looks like the ${role} (${quoteList(found)}); name it with --map`);
  return found[0];
}

export function detectColumns(headers: string[]): ColumnMap {
  const isKey = (h: string) => KEY_RE.test(h);
  const timestamp = unique(headers, (h) => TIMESTAMP_RE.test(h), "timestamp");
  let unit: string | undefined;
  for (const re of UNIT_RES) {
    unit = unique(headers, (h) => re.test(h) && !isKey(h) && h !== timestamp, "unit id");
    if (unit) break;
  }
  if (!unit)
    throw new Error(
      `no column looks like the participant unit's handle (headers: ${quoteList(headers)}); name it with --map`,
    );
  const keyCols = headers.filter((h) => isKey(h) && h !== unit && h !== timestamp);
  const provider = unique(
    headers,
    (h) => PROVIDER_RE.test(h) && !isKey(h) && h !== unit && h !== timestamp,
    "provider",
  );
  // One key column per provider (the provider named in the header) and no provider column.
  const perProvider = keyCols.map((h) => [normalizeProvider(h), h] as const);
  if (!provider && keyCols.length >= 1 && perProvider.every(([p]) => p !== undefined)) {
    const providerKeys: Partial<Record<Provider, string>> = {};
    for (const [p, h] of perProvider) {
      if (providerKeys[p!]) throw new Error(`two key columns for ${p}; name them with --map`);
      providerKeys[p!] = h;
    }
    return { ...(timestamp ? { timestamp } : {}), unit, providerKeys };
  }
  if (keyCols.length === 0)
    throw new Error(`no column looks like the API key (headers: ${quoteList(headers)}); name it with --map`);
  if (keyCols.length > 1)
    throw new Error(`more than one column looks like the API key (${quoteList(keyCols)}); name it with --map`);
  return {
    ...(timestamp ? { timestamp } : {}),
    unit,
    ...(provider ? { provider } : {}),
    key: keyCols[0],
  };
}

export function loadColumnMap(doc: unknown): ColumnMap {
  const d = doc as Record<string, unknown> | null;
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("the column map must be a mapping");
  for (const k of Object.keys(d))
    if (!["timestamp", "unit", "provider", "key", "providerKeys"].includes(k))
      throw new Error(`column map: unknown entry ${k} (timestamp | unit | provider | key | providerKeys)`);
  const str = (k: string) => {
    const v = d[k];
    if (v === undefined) return undefined;
    if (typeof v !== "string" || v === "") throw new Error(`column map: ${k} must be a header name`);
    return v;
  };
  const unit = str("unit");
  if (!unit) throw new Error("column map: unit is required");
  const out: ColumnMap = { unit };
  const timestamp = str("timestamp");
  const provider = str("provider");
  const key = str("key");
  if (timestamp) out.timestamp = timestamp;
  if (provider) out.provider = provider;
  if (key) out.key = key;
  if (d.providerKeys !== undefined) {
    if (!d.providerKeys || typeof d.providerKeys !== "object" || Array.isArray(d.providerKeys))
      throw new Error("column map: providerKeys must map a provider to a header name");
    const pk: Partial<Record<Provider, string>> = {};
    for (const [p, h] of Object.entries(d.providerKeys as Record<string, unknown>)) {
      if (!PROVIDERS.includes(p as Provider))
        throw new Error(`column map: providerKeys.${p} is not a provider (ollama | openai | anthropic)`);
      if (typeof h !== "string" || h === "")
        throw new Error(`column map: providerKeys.${p} must be a header name`);
      pk[p as Provider] = h;
    }
    out.providerKeys = pk;
  }
  if (!out.key && !out.providerKeys)
    throw new Error("column map: name the key column (key) or one per provider (providerKeys)");
  if (out.key && out.providerKeys) throw new Error("column map: key and providerKeys are exclusive");
  if (out.provider && out.providerKeys)
    throw new Error("column map: provider has no meaning with providerKeys (the column says the provider)");
  return out;
}

// --- rows ------------------------------------------------------------------------------------------

// Google Forms writes the timestamp in the form owner's locale and time zone, without the zone:
// "2026/10/21 9:05:03" (ja), "10/21/2026 9:05:03" (en-US), or ISO 8601. Only the order matters here,
// and every row of one export shares the zone, so it is read as if it were UTC.
export function parseFormTimestamp(text: string): number | undefined {
  const t = text.trim();
  if (t === "") return undefined;
  let m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(t);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(t);
  if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  const iso = Date.parse(t);
  return Number.isNaN(iso) ? undefined : iso;
}

// At most the first 4 and last 2 characters, and only of a key long enough that they say nothing.
export function maskKey(key: string): string {
  return key.length >= 20
    ? `${key.slice(0, 4)}…${key.slice(-2)} (${key.length} chars)`
    : `**** (${key.length} chars)`;
}

// Warnings, never errors: providers change their formats, and a key the proxy forwards is checked
// by the provider. What is caught here is the answer that went into the wrong field.
export function keyWarnings(provider: Provider, key: string): string[] {
  const w: string[] = [];
  if (key.length < 20) w.push(`is only ${key.length} characters`);
  if (provider === "anthropic" && !key.startsWith("sk-ant-")) w.push("does not start with sk-ant-");
  if (provider === "openai") {
    if (key.startsWith("sk-ant-")) w.push("looks like an Anthropic key (sk-ant-)");
    else if (!key.startsWith("sk-")) w.push("does not start with sk-");
  }
  if (provider === "ollama" && key.startsWith("sk-"))
    w.push(`looks like an ${key.startsWith("sk-ant-") ? "Anthropic" : "OpenAI"} key (sk-)`);
  return w;
}

export type Answer = { row: number; unit: string; provider: Provider; key: string; at?: number };
export type Problem = { row: number; unit?: string; message: string };

export type BuildResult = {
  keys: ParticipantKeys;
  answers: number; // (unit, provider) answers read
  replaced: { unit: string; provider: Provider; row: number; by: number }[];
  errors: Problem[];
  warnings: Problem[];
  columns: ColumnMap;
};

export function buildKeys(csv: string, map?: ColumnMap): BuildResult {
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new Error("the CSV is empty");
  const headers = rows[0].map((h) => h.trim());
  const columns = map ?? detectColumns(headers);
  const index = (h: string) => {
    const i = headers.indexOf(h.trim());
    if (i < 0) throw new Error(`no column ${JSON.stringify(h)} in the CSV (headers: ${quoteList(headers)})`);
    return i;
  };
  const tsCol = columns.timestamp !== undefined ? index(columns.timestamp) : undefined;
  const unitCol = index(columns.unit);
  const providerCol = columns.provider !== undefined ? index(columns.provider) : undefined;
  const keyCol = columns.key !== undefined ? index(columns.key) : undefined;
  const perProvider = Object.entries(columns.providerKeys ?? {}).map(
    ([p, h]) => [p as Provider, index(h!)] as const,
  );

  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  const answers: Answer[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const row = r + 1; // the spreadsheet's row number (the header is row 1)
    const cell = (i: number | undefined) => (i === undefined ? "" : (cells[i] ?? "").trim());
    if (cells.every((c) => c.trim() === "")) continue;
    const unit = cell(unitCol).normalize("NFKC");
    const problem = (message: string) => errors.push({ row, ...(unit ? { unit } : {}), message });
    if (!unit) {
      problem("no unit id");
      continue;
    }
    if (RESERVED_IDS.has(unit)) {
      problem(`unit id ${JSON.stringify(unit)} is a reserved directory name`);
      continue;
    }
    if (!UNIT_ID_RE.test(unit)) {
      problem(
        `unit id ${JSON.stringify(unit)} is not a roster id (letters, digits, - and _, starting with a letter or digit)`,
      );
      continue;
    }
    let at: number | undefined;
    if (tsCol !== undefined) {
      at = parseFormTimestamp(cell(tsCol));
      if (at === undefined) {
        problem(`unreadable timestamp ${JSON.stringify(cell(tsCol))}`);
        continue;
      }
    }
    const pairs: [Provider | undefined, string, string][] = [];
    if (keyCol !== undefined) {
      const raw = cell(keyCol);
      if (providerCol !== undefined) {
        const label = cell(providerCol);
        pairs.push([normalizeProvider(label), label, raw]);
      } else {
        // No provider question on the form: the key's own prefix is the only evidence.
        const guess = raw.startsWith("sk-ant-") ? "anthropic" : raw.startsWith("sk-") ? "openai" : undefined;
        pairs.push([guess, "", raw]);
      }
    } else {
      for (const [p, i] of perProvider) if (cell(i) !== "") pairs.push([p, p, cell(i)]);
      if (pairs.length === 0) problem("no key in any provider column");
    }
    for (const [provider, label, key] of pairs) {
      if (!provider) {
        problem(
          providerCol === undefined && keyCol !== undefined
            ? "cannot tell the provider: the form has no provider column and the key has no known prefix"
            : `unknown provider ${JSON.stringify(label)} (ollama | openai | anthropic)`,
        );
        continue;
      }
      if (key === "") {
        problem(`empty ${provider} key`);
        continue;
      }
      if (/\s/.test(key)) {
        problem(`the ${provider} key contains whitespace`);
        continue;
      }
      for (const w of keyWarnings(provider, key))
        warnings.push({ row, unit, message: `${provider} key ${maskKey(key)} ${w}` });
      answers.push({ row, unit, provider, key, ...(at !== undefined ? { at } : {}) });
    }
  }

  // Latest answer per (unit, provider): by timestamp, then by row.
  const order = [...answers].sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.row - b.row);
  const latest = new Map<string, Answer>();
  const replaced: BuildResult["replaced"] = [];
  for (const a of order) {
    const k = `${a.unit}\u0000${a.provider}`;
    const prev = latest.get(k);
    if (prev) replaced.push({ unit: a.unit, provider: a.provider, row: prev.row, by: a.row });
    latest.set(k, a);
  }
  const keys: ParticipantKeys = {};
  const sorted = [...latest.values()].sort(
    (x, y) => x.unit.localeCompare(y.unit) || x.provider.localeCompare(y.provider),
  );
  for (const a of sorted) (keys[a.unit] ??= {})[a.provider] = a.key;
  return { keys, answers: answers.length, replaced, errors, warnings, columns };
}

// --- roster ----------------------------------------------------------------------------------------

// A competition config (`agents:`), a roster file, or a registrations file (`registrations:`).
export function rosterIds(doc: unknown): string[] {
  const d = doc as Record<string, unknown> | unknown[] | null;
  const list = Array.isArray(d) ? d : (d?.agents ?? d?.registrations);
  if (!Array.isArray(list)) throw new Error("the roster must have an `agents` list");
  return list.map((e, i) => {
    const id = (e as { id?: unknown })?.id;
    if (typeof id !== "string" || id === "") throw new Error(`roster agents[${i}] has no id`);
    return id;
  });
}

export function compareRoster(
  keys: ParticipantKeys,
  roster: string[],
): { noKey: string[]; notInRoster: string[] } {
  const inRoster = new Set(roster);
  return {
    noKey: roster.filter((id) => !keys[id] || Object.keys(keys[id]).length === 0),
    notInRoster: Object.keys(keys).filter((id) => !inRoster.has(id)),
  };
}

// --- output ----------------------------------------------------------------------------------------

export function renderKeysFile(keys: ParticipantKeys, source: string, now = new Date()): string {
  return (
    `# Participant inference credentials (rules §2.5), generated ${now.toISOString()} from ${source}\n` +
    "# by `npm run inference-keys`. chmod 600, never in a repository, delete after the event.\n" +
    stringifyYaml({ participants: keys })
  );
}

// Mode 0600 from the first byte (a temp file in the same directory, then a rename), so the keys are
// never readable by anyone else even for an instant, and an existing file is replaced whole or not
// at all.
export function writeKeysFile(path: string, content: string, force: boolean): void {
  if (existsSync(path) && !force) throw new Error(`${path} exists; pass --force to replace it`);
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
  try {
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // already gone
    }
    throw e;
  }
}

// --- CLI -------------------------------------------------------------------------------------------

const USAGE =
  "usage: npm run inference-keys -- <responses.csv> --out <inference-keys.yaml> [--map <column-map.yaml>] " +
  "[--roster <field.yaml>] [--force] [--skip-invalid]";

export function parseArgs(argv: string[]): { csv?: string; flags: Record<string, string> } {
  const flags: Record<string, string> = {};
  let csv: string | undefined;
  const bool = new Set(["force", "skip-invalid"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (bool.has(name)) flags[name] = "1";
      else {
        const v = argv[++i];
        if (v === undefined || v.startsWith("--")) throw new Error(`--${name} needs a value`);
        flags[name] = v;
      }
    } else if (csv === undefined) csv = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  return { csv, flags };
}

export function main(
  argv: string[],
  log: (s: string) => void = console.log,
  err: (s: string) => void = console.error,
): number {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err(`${(e as Error).message}\n${USAGE}`);
    return 1;
  }
  const { csv, flags } = args;
  if (!csv || !flags.out) {
    err(USAGE);
    return 1;
  }
  try {
    const map = flags.map ? loadColumnMap(parseYaml(readFileSync(resolve(flags.map), "utf8"))) : undefined;
    const result = buildKeys(readFileSync(resolve(csv), "utf8"), map);
    const c = result.columns;
    log(
      `columns: unit=${JSON.stringify(c.unit)}` +
        (c.timestamp ? ` timestamp=${JSON.stringify(c.timestamp)}` : " timestamp=(none: row order decides)") +
        (c.key
          ? ` key=${JSON.stringify(c.key)} provider=${c.provider ? JSON.stringify(c.provider) : "(from the key's prefix)"}`
          : "") +
        (c.providerKeys ? ` keys per provider=${JSON.stringify(c.providerKeys)}` : ""),
    );
    for (const w of result.warnings) err(`  warn  row ${w.row}${w.unit ? ` ${w.unit}` : ""}: ${w.message}`);
    for (const e of result.errors) err(`  error row ${e.row}${e.unit ? ` ${e.unit}` : ""}: ${e.message}`);
    for (const r of result.replaced) log(`  row ${r.by} replaces row ${r.row} (${r.unit} / ${r.provider})`);
    if (result.errors.length > 0 && !flags["skip-invalid"]) {
      err(
        `${result.errors.length} row(s) could not be read; fix the export or the map, or pass ` +
          "--skip-invalid to leave them out. Nothing written.",
      );
      return 1;
    }
    const units = Object.keys(result.keys);
    if (units.length === 0) {
      err("no usable answers; nothing written");
      return 1;
    }
    const out = resolve(flags.out);
    writeKeysFile(out, renderKeysFile(result.keys, basename(csv)), Boolean(flags.force));
    // The proof that the proxy can start with it: the proxy's own loader, on the bytes on disk.
    const reread = loadParticipantKeys(parseYaml(readFileSync(out, "utf8")));
    if (!isDeepStrictEqual(reread, result.keys)) throw new Error(`${out} did not read back as written`);

    log(
      `wrote ${out} (mode 600): ${units.length} unit(s), ${result.answers} answer(s) read, ` +
        `${result.replaced.length} replaced by a later answer` +
        (result.errors.length ? `, ${result.errors.length} row(s) skipped` : ""),
    );
    log(
      `  by provider: ${PROVIDERS.map((p) => `${p} ${units.filter((u) => result.keys[u][p]).length}`).join(", ")}`,
    );
    for (const u of units)
      log(
        `  ${u}: ${Object.entries(result.keys[u])
          .map(([p, k]) => `${p} ${maskKey(k!)}`)
          .join(", ")}`,
      );
    if (flags.roster) {
      const roster = rosterIds(parseYaml(readFileSync(resolve(flags.roster), "utf8")));
      const { noKey, notInRoster } = compareRoster(result.keys, roster);
      log(
        `roster ${flags.roster}: ${roster.length} agent(s); ${noKey.length} without a key` +
          (noKey.length ? ` (${noKey.join(", ")})` : "") +
          `; ${notInRoster.length} unit(s) with a key and no roster entry` +
          (notInRoster.length ? ` (${notInRoster.join(", ")})` : ""),
      );
    }
    return 0;
  } catch (e) {
    err(`inference-keys: ${(e as Error).message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
