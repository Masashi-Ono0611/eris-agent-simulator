// The sponsor's view: a non-public mount of the runs API, behind a bearer token.
//
//   /sponsor/runs/index.json                     the same index the public view serves
//   /sponsor/runs/mode.json                      {audience: true, standings, sponsor: true}
//   /sponsor/runs/<id>/<artifact>                an artifact, redacted as for the audience
//   /sponsor/runs/<id>/agents/<agentId>.jsonl    a participant's decision log (also .llm.jsonl)
//   /sponsor/runs/<id>/tail/<file>?offset=N      incremental tail, as for the public view
//   /sponsor/inference/index.json                the inference proxy's record files
//   /sponsor/inference/<path>.jsonl              one record file (one agent's calls)
//   /sponsor/inference/tail/<path>.jsonl?offset=N
//
// Why it exists: the sponsorship gives the sponsor real-time access to processed run data for the
// whole provision period, and the privacy policy promises that only processed data is provided and
// that every access is recorded. "Processed" here means what the public view already serves -- the
// run artifacts keyed by competition handles and wallet addresses, with the scenario secrets
// (seeds, future stress windows, vuln ground truth, calibration warnings, stderr) withheld, because
// the sponsor reading them during the live week is still someone outside the field learning the
// scenario -- plus the two things the public never gets: the participants' decision logs and the
// inference proxy's per-agent records of their LLM exchanges. Neither of those is redacted: they are
// the participants' own free-form text, and there is nothing in them to strip line by line that a
// rule could find. Real names and contact details never enter a run directory (no writer has a field
// for them); what a participant chose to type into a prompt is theirs.
//
// The door:
//   - a token file (ERIS_DASHBOARD_SPONSOR_TOKENS_FILE), one `<sha256 hex of the token> <label>` per
//     line, `#` for comments. The server never holds a token, only its digest, and compares the
//     digest of the presented one against every line in constant time. The file is re-checked on
//     every request (a stat), so issuing and revoking is an edit, not a restart -- revoke comments
//     the line out, which keeps who had access and until when in the same file
//   - an unreadable or missing token file admits nobody. A broken file fails closed: unlike the RPC
//     gateway (infra/rpc-gateway/gateway.mjs, which keeps the old keys so a typo does not lock every
//     participant out), the cost of the other mistake here is a revoked sponsor still reading
//   - a request without a valid token is 401 before any path is looked at, so the status says
//     nothing about what exists
//   - every admitted request is appended to ERIS_DASHBOARD_SPONSOR_ACCESS_LOG (label, method, path,
//     time) *before* anything is served. If that line cannot be written the request is 503 and
//     nothing is served: an access that is not recorded is one the privacy commitment does not allow
//   - every answer is `cache-control: private, no-store`, so no shared cache in front of the
//     dashboard can hand a token-bearing answer to the next reader
import fs from "node:fs";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRunsApi, queryByteCount } from "./runsApi.js";

/** The mount point on the hosted server. */
export const SPONSOR_PREFIX = "/sponsor";

// Bounds on what is taken as a token, before it is hashed. The issued ones are 64 hex characters.
const MIN_TOKEN = 16;
const MAX_TOKEN = 256;

// What a tail request reads at most, as the runs API's tail.
const TAIL_CHUNK_BYTES = 4 * 1024 * 1024;

// How deep the inference index looks: the proxy writes <dir>/<agentId>.jsonl, and an operator who
// keeps one directory per week or per competition puts one more level above it.
const INFERENCE_INDEX_DEPTH = 2;

// The longest request path written to the access log; the rest is cut and marked.
const MAX_LOGGED_PATH = 1024;

const NO_STORE = "private, no-store";

export type SponsorToken = { digest: Buffer; label: string };

/**
 * The token file's lines: `<64 hex> <label>`, anything after the label ignored (the issue script
 * writes the issue time there), `#` starts a comment, blank lines and malformed lines are skipped.
 */
export function parseTokenFile(text: string): SponsorToken[] {
  const out: SponsorToken[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const [digest, label] = line.split(/\s+/);
    if (!/^[0-9a-f]{64}$/i.test(digest ?? "") || !label) continue;
    out.push({ digest: Buffer.from(digest.toLowerCase(), "hex"), label });
  }
  return out;
}

/**
 * The token store. `verify` takes an Authorization header value and returns the label of the token
 * it carries, or null. The file is re-read whenever its size, mtime or inode changes.
 */
export function createTokenStore(file: string) {
  let tokens: SponsorToken[] = [];
  let seen: string | null = null;

  function refresh(): void {
    let stamp: string;
    try {
      const st = fs.statSync(file);
      stamp = `${st.ino}:${st.size}:${st.mtimeMs}`;
    } catch {
      // Gone: nobody is admitted until it is back.
      tokens = [];
      seen = null;
      return;
    }
    if (stamp === seen) return;
    try {
      tokens = parseTokenFile(fs.readFileSync(file, "utf8"));
      seen = stamp;
    } catch {
      tokens = [];
      seen = null;
    }
  }

  function verify(authorization: string | string[] | undefined): string | null {
    refresh();
    const value = Array.isArray(authorization) ? authorization[0] : authorization;
    const m = /^Bearer\s+(\S+)\s*$/i.exec(value ?? "");
    const token = m?.[1];
    if (!token || token.length < MIN_TOKEN || token.length > MAX_TOKEN) return null;
    const digest = createHash("sha256").update(token).digest();
    // Every line is compared, whether or not an earlier one matched, so the time taken does not
    // depend on where in the file (or whether) the token is.
    let label: string | null = null;
    for (const t of tokens) {
      if (timingSafeEqual(digest, t.digest) && label === null) label = t.label;
    }
    return label;
  }

  return {
    verify,
    count: (): number => {
      refresh();
      return tokens.length;
    },
  };
}

export type SponsorOptions = {
  runsDir: string;
  tokensFile: string;
  /** Append-only record of every admitted request. Unset = every admitted request is 503. */
  accessLog?: string;
  /** The inference proxy's --record directory. Unset = /sponsor/inference/* is 404. */
  inferenceDir?: string;
  competitions?: readonly string[];
  standings?: boolean;
  /** For tests. */
  now?: () => Date;
};

function decode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/**
 * The sponsor mount. `handle` takes a path relative to the server root ("/sponsor/runs/...") and
 * returns false when the path is not under the mount, so the caller can fall through.
 */
export function createSponsorApi(options: SponsorOptions) {
  const store = createTokenStore(options.tokensFile);
  const now = options.now ?? (() => new Date());
  const runs = createRunsApi(options.runsDir, {
    sponsor: true,
    standings: options.standings ?? true,
    ...(options.competitions && options.competitions.length > 0
      ? { competitions: options.competitions }
      : {}),
  });
  const inferenceRoot = options.inferenceDir ? path.resolve(options.inferenceDir) : null;

  function status(res: ServerResponse, code: number): void {
    res.statusCode = code;
    res.setHeader("cache-control", NO_STORE);
    if (code === 401) res.setHeader("www-authenticate", 'Bearer realm="sponsor"');
    res.end();
  }

  /** The line the privacy commitment requires; false when it could not be written. */
  function record(label: string, req: IncomingMessage, url: string): boolean {
    if (!options.accessLog) return false;
    const p = url.length > MAX_LOGGED_PATH ? `${url.slice(0, MAX_LOGGED_PATH)}...` : url;
    const line = JSON.stringify({
      ts: now().toISOString(),
      label,
      method: req.method ?? "GET",
      path: p,
    });
    try {
      fs.appendFileSync(options.accessLog, `${line}\n`, { mode: 0o600 });
      return true;
    } catch (err) {
      console.error(
        `[dashboard] sponsor access log not writable (${options.accessLog}): ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** A path under the inference directory as a real file inside it, or null. */
  function inferenceFile(rel: string): string | null {
    if (!inferenceRoot || rel.includes("\0")) return null;
    const clean = path.posix.normalize(rel.replace(/^\/+/, ""));
    if (clean === ".." || clean.startsWith("../") || path.posix.isAbsolute(clean)) return null;
    if (!/\.jsonl$/.test(clean) || clean.split("/").some((seg) => seg.startsWith(".")))
      return null;
    try {
      const realRoot = fs.realpathSync(inferenceRoot);
      const real = fs.realpathSync(path.resolve(inferenceRoot, clean));
      if (!real.startsWith(realRoot + path.sep)) return null;
      return fs.statSync(real).isFile() ? real : null;
    } catch {
      return null;
    }
  }

  type InferenceEntry = { path: string; bytes: number; mtimeMs: number };

  function inferenceIndex(): InferenceEntry[] {
    if (!inferenceRoot) return [];
    const root = inferenceRoot;
    const out: InferenceEntry[] = [];
    const walk = (rel: string, depth: number): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory() && depth < INFERENCE_INDEX_DEPTH) walk(childRel, depth + 1);
        else if (e.isFile() && e.name.endsWith(".jsonl")) {
          try {
            const st = fs.statSync(path.join(root, childRel));
            out.push({ path: childRel, bytes: st.size, mtimeMs: st.mtimeMs });
          } catch {
            // vanished between the listing and the stat
          }
        }
      }
    };
    walk("", 0);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  function handleInference(rest: string, query: string | undefined, res: ServerResponse): void {
    if (!inferenceRoot) return status(res, 404);
    if (rest === "/index.json") {
      res.setHeader("cache-control", NO_STORE);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(inferenceIndex()));
      return;
    }
    const isTail = rest.startsWith("/tail/");
    const decoded = decode(isTail ? rest.slice("/tail".length) : rest);
    if (decoded === null) return status(res, 400);
    const file = inferenceFile(decoded);
    if (!file) return status(res, 404);
    res.setHeader("cache-control", NO_STORE);
    if (!isTail) {
      res.setHeader("content-type", "text/plain; charset=utf-8");
      const stream = fs.createReadStream(file);
      stream.on("error", () => {
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      });
      stream.pipe(res);
      return;
    }
    // The same answer shape as the runs API's tail: {offset, text}, at most 4 MiB per call, whole
    // lines only (a record cut in half is not JSON).
    const params = new URLSearchParams(query ?? "");
    const offset = queryByteCount(params.get("offset"), 0);
    const limit = Math.min(
      TAIL_CHUNK_BYTES,
      Math.max(1, queryByteCount(params.get("limit"), 0) || TAIL_CHUNK_BYTES),
    );
    res.setHeader("content-type", "application/json");
    let fd: number | null = null;
    try {
      const size = fs.statSync(file).size;
      const start = Math.min(offset, size);
      const len = Math.min(size - start, limit);
      if (len <= 0) {
        res.end(JSON.stringify({ offset: size, text: "" }));
        return;
      }
      fd = fs.openSync(file, "r");
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      const cut = buf.lastIndexOf(0x0a);
      if (cut < 0) {
        res.end(JSON.stringify({ offset: start, text: "" }));
        return;
      }
      res.end(
        JSON.stringify({
          offset: start + cut + 1,
          text: buf.subarray(0, cut + 1).toString("utf8"),
        }),
      );
    } catch {
      if (!res.writableEnded) res.end(JSON.stringify({ offset, text: "" }));
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
  }

  return function handle(
    urlPath: string,
    query: string | undefined,
    req: IncomingMessage,
    res: ServerResponse,
  ): boolean {
    if (urlPath !== SPONSOR_PREFIX && !urlPath.startsWith(`${SPONSOR_PREFIX}/`)) return false;
    // Authentication first, before the path is so much as parsed: a 401 must look the same for a
    // file that exists, one that does not, and one that is withheld.
    const label = store.verify(req.headers.authorization);
    if (label === null) {
      status(res, 401);
      return true;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      status(res, 405);
      return true;
    }
    if (!record(label, req, query ? `${urlPath}?${query}` : urlPath)) {
      status(res, 503);
      return true;
    }
    const rest = urlPath.slice(SPONSOR_PREFIX.length);
    if (rest === "/runs" || rest.startsWith("/runs/")) {
      const sub = rest.slice("/runs".length) || "/";
      if (!runs(sub, query, req, res)) status(res, 404);
      return true;
    }
    if (rest.startsWith("/inference/")) {
      handleInference(rest.slice("/inference".length), query, res);
      return true;
    }
    status(res, 404);
    return true;
  };
}

export type SponsorEnv = {
  tokensFile: string;
  accessLog?: string;
  inferenceDir?: string;
};

/**
 * ERIS_DASHBOARD_SPONSOR_TOKENS_FILE  the token file. Unset = no sponsor view: every /sponsor path
 *                                     is a plain 404, as on a server that never had one
 * ERIS_DASHBOARD_SPONSOR_ACCESS_LOG   the append-only access record. Required for anything to be
 *                                     served: without it every authenticated request is 503
 * ERIS_DASHBOARD_INFERENCE_DIR        the inference proxy's --record directory. Optional
 */
export function sponsorFromEnv(env: NodeJS.ProcessEnv = process.env): SponsorEnv | null {
  const tokensFile = env.ERIS_DASHBOARD_SPONSOR_TOKENS_FILE?.trim();
  if (!tokensFile) return null;
  const accessLog = env.ERIS_DASHBOARD_SPONSOR_ACCESS_LOG?.trim();
  const inferenceDir = env.ERIS_DASHBOARD_INFERENCE_DIR?.trim();
  return {
    tokensFile,
    ...(accessLog ? { accessLog } : {}),
    ...(inferenceDir ? { inferenceDir } : {}),
  };
}
