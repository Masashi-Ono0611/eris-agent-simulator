#!/usr/bin/env python3
"""Stand-in for `claude -p` (ERIS_CLAUDE_BIN) that installs a canned revision first and then asks a real
model. Call N answers with $REVTEST_REPLIES/NN.json when that file exists; any other call is sent to
the OpenAI chat completions API with $REVTEST_MODEL, using only the ASCON key file. This measures
whether the real model, under the agent's prompt.md, notices a broken version and reverts it.
"""
import json
import os
import sys
import urllib.request

args = sys.argv[1:]


def flag(name):
    return args[args.index(name) + 1] if name in args else ""


state = os.environ["REVTEST_STATE"]
n = int(open(state).read().strip()) + 1 if os.path.exists(state) else 1
open(state, "w").write(f"{n}\n")
canned = os.path.join(os.environ["REVTEST_REPLIES"], f"{n:02d}.json")
with open(state + ".calls", "a") as log:
    log.write(f"call={n} {'canned ' + os.path.basename(canned) if os.path.exists(canned) else 'model'}\n")
if os.path.exists(canned):
    sys.stdout.write(open(canned).read())
    sys.exit(0)

keyfile = os.environ.get("ASCON_OPENAI_ENV", os.path.expanduser("~/.config/secrets/ascon-openai.env"))
key = next(l.split("=", 1)[1].strip() for l in open(keyfile) if l.startswith("ASCON_OPENAI_API_KEY="))
body = {
    "model": os.environ["REVTEST_MODEL"],
    "messages": [
        {"role": "system", "content": flag("--append-system-prompt")},
        {"role": "user", "content": flag("-p")},
    ],
    "response_format": {"type": "json_object"},
}
req = urllib.request.Request(
    "https://api.openai.com/v1/chat/completions",
    data=json.dumps(body).encode(),
    headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
)
with urllib.request.urlopen(req, timeout=290) as r:
    sys.stdout.write(json.load(r)["choices"][0]["message"]["content"])
