// Rules Appendix A lists OpenAI's pro and codex models, which are served on the Responses API only,
// and OpenAI's gpt-oss-<size> ids. The reference runtime has to route both: the Responses models to
// /v1/responses with that API's field names, everything else on Chat Completions as before, and
// gpt-oss-<size> to OpenAI while Ollama's gpt-oss:<size> stays with Ollama.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  callLlmWithUsage,
  LlmOutputTruncatedError,
  openAiUsesResponses,
  resolveLlmProvider,
} from "../example/agents/runtime/llm.js";

type Call = { path: string; body: Record<string, unknown> };
const calls: Call[] = [];
let answer: (call: Call) => unknown = () => ({});

let server: http.Server;
before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const call = {
        path: new URL(req.url ?? "/", "http://x").pathname,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
      };
      calls.push(call);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(answer(call)));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  process.env.ERIS_INFERENCE_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  delete process.env.ERIS_LLM_MAX_OUTPUT_TOKENS;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

const TEXT = '{"notes":"ok","executorTs":null}';
const request = (model: string) => ({
  model,
  system: "revise the strategy",
  messages: [{ role: "user" as const, content: "state" }],
  maxOutputTokens: 5000,
});

test("gpt-oss-<size> is OpenAI's id; Ollama's gpt-oss:<size> stays with Ollama", () => {
  assert.equal(resolveLlmProvider("gpt-oss-120b").kind, "openai");
  assert.equal(resolveLlmProvider("gpt-oss-20b").kind, "openai");
  assert.equal(resolveLlmProvider("gpt-oss:120b").kind, "ollama");
  assert.equal(resolveLlmProvider("o3-pro").kind, "openai");
  assert.equal(resolveLlmProvider("gpt-6-astra").kind, "openai");
});

test("the pro and codex models use the Responses API; the rest stay on Chat Completions", () => {
  for (const m of ["gpt-5.5-pro", "gpt-5.4-pro", "gpt-5.2-pro", "gpt-5-pro", "o3-pro", "gpt-5.3-codex", "openai:gpt-5-pro"])
    assert.equal(openAiUsesResponses(m), true, m);
  for (const m of ["gpt-6-astra", "gpt-6.1-sol", "gpt-5.5", "gpt-5-mini", "o3", "gpt-4o", "gpt-oss-120b"])
    assert.equal(openAiUsesResponses(m), false, m);
});

test("a Responses model is sent as instructions/input/text.format/max_output_tokens and its text is read from output", async () => {
  calls.length = 0;
  answer = () => ({
    status: "completed",
    output: [
      { type: "reasoning", summary: [] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: TEXT }] },
    ],
    usage: { input_tokens: 21, output_tokens: 9 },
  });
  const reply = await callLlmWithUsage(request("gpt-5.5-pro"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/v1/responses");
  assert.equal(calls[0].body.model, "gpt-5.5-pro");
  assert.equal(calls[0].body.instructions, "revise the strategy");
  assert.deepEqual(calls[0].body.input, [{ role: "user", content: "state" }]);
  assert.deepEqual(calls[0].body.text, { format: { type: "json_object" } });
  assert.equal(calls[0].body.max_output_tokens, 5000);
  assert.equal(calls[0].body.messages, undefined);
  assert.equal(reply.text, TEXT);
  assert.deepEqual(reply.usage, { inputTokens: 21, outputTokens: 9 });
});

test("a Responses reply cut at its cap is a truncation, not an answer", async () => {
  answer = () => ({
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    output: [{ type: "message", content: [{ type: "output_text", text: '{"notes":"cut' }] }],
    usage: { input_tokens: 21, output_tokens: 5000 },
  });
  await assert.rejects(callLlmWithUsage(request("o3-pro")), LlmOutputTruncatedError);
});

test("other OpenAI models are unchanged: Chat Completions", async () => {
  calls.length = 0;
  answer = () => ({
    choices: [{ message: { content: TEXT }, finish_reason: "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: 7 },
  });
  const reply = await callLlmWithUsage(request("gpt-6-astra"));
  assert.equal(calls[0].path, "/v1/chat/completions");
  assert.equal(reply.text, TEXT);
});
