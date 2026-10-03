# ASCON release preparation

Run this only in a release worktree whose `sdk/src/constants.local.ts` matches the selected upstream commit. Do not run backtests in that worktree.

```sh
python3 ascon-notes/release/prepare-release.py \
  --source ascon-epsilon --name ascon-final-epsilon \
  --delta-params '{"SAFETY_MARGIN_BPS":75}' \
  --epsilon-params '{"launch":true,"redemption":false}'
```

The output is a separate agent directory; the source is read-only. Omitted parameter flags embed `undefined`, preserving parser defaults. `--dry-run` checks arguments and source presence without writing and reports `NOT READY` because release checks did not run. `--skip-checks` likewise cannot produce a ready result. Use `--upstream-ref` to select the exact commit carrying the operator address table. The final ZIP digest and repository commit are intended for the submission record.

Run the offline tool tests with `node --import tsx --test test/ascon-release-prepare.test.ts`.
