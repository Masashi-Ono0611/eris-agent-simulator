import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadImproveAgent } from "../../example/agents/runtime/improve.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const stagedPrompts = resolve(process.argv[2] ?? join(here, "prompts"));
const exampleAgents = process.argv[3] ? resolve(process.argv[3]) : undefined;
const required = [
  "transactions since the last revision",
  "market history",
  "mean inclusion latency",
  "executorTs",
  "revertTo",
];
const tempRoot = mkdtempSync(join(tmpdir(), "ascon-prompt-check-"));

function checkAgentRoot(root: string, label: string): void {
  const dirs = readdirSync(root).filter((name) => existsSync(join(root, name, "prompt.md")));
  for (const name of dirs) {
    const agent = loadImproveAgent(join(root, name));
    assert.equal(agent.name, name, `${label}/${name}: frontmatter name must match directory`);
    for (const phrase of required)
      assert.ok(agent.body.includes(phrase), `${label}/${name}: missing ${phrase}`);
    assert.ok(!agent.body.includes("rolled back automatically"), `${label}/${name}: forbidden rollback promise`);
    console.log(`PASS ${label}/${name}`);
  }
  return;
}

try {
  const stagedDirs = readdirSync(stagedPrompts).filter((name) => name.endsWith(".md"));
  for (const file of stagedDirs) {
    const name = file.slice(0, -3);
    const dir = join(tempRoot, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "prompt.md"), readFileSync(join(stagedPrompts, file), "utf8"));
  }
  checkAgentRoot(tempRoot, "staged");
  if (exampleAgents) checkAgentRoot(exampleAgents, "example");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
