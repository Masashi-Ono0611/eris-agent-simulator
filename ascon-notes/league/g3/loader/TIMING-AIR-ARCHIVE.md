# Preserved Air attempts — aborted, Air, load guard

Archive label: **aborted, Air, load guard**. These six files are retained byte-for-byte.
This label describes the incomplete Air attempt set: the measurement and positive control aborted; the negative control was refused before starting. Validation records the incomplete outcome.
Air identity supplied by the operator; recorded hardware: darwin / arm64 / Apple M5 / 10 logical CPUs. No hostname is stored here.
These are historical partial results, not measurements for the planned Intel Mac mini. Never reuse their timing numbers in a new-host report.

| Archived file | SHA-256 |
| --- | --- |
| [TIMING-MEASUREMENT-2026-10-09.json](TIMING-MEASUREMENT-2026-10-09.json) | `af33012a680cfaf31a46c1144dedea74b54d2825f6eb609e35d7e57781bc8080` |
| [TIMING-MEASUREMENT-2026-10-09.md](TIMING-MEASUREMENT-2026-10-09.md) | `3bbbaf1bc50a25db0de989231bdbecdf6d9a4ca159a7fbf5cca8e4defa3d11ea` |
| [TIMING-VALIDATION-2026-10-09.json](TIMING-VALIDATION-2026-10-09.json) | `a96d7bf747ccf227f322bd50c87c79d1abde6c5f741056ca868d165dfff8d288` |
| [TIMING-VALIDATION-2026-10-09.md](TIMING-VALIDATION-2026-10-09.md) | `23608bdc5b2b25f5dfc54b6180314bd963877546fbebc7000d72ca9c6b6c53bf` |
| [TIMING-CONTROLS-2026-10-09.json](../tests/TIMING-CONTROLS-2026-10-09.json) | `de50b877467d916bcdcff5e039acb4e012588eb2dedee6c6bfabf656ec812836` |
| [TIMING-CONTROLS-2026-10-09.md](../tests/TIMING-CONTROLS-2026-10-09.md) | `90560ec1ff5280b0433b36d9114be20db74b802affaba1f4c047d997053b8905` |

New runs must select unused prefixes with `--output` and `G3_TIMING_CONTROL_OUTPUT`; both JSON and Markdown are checked before measurement and exclusively created. Do not regenerate these archived Markdown files with the newer renderer.
