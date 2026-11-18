# Senior-only engineering policy

This is a configuration for supported coding agents, not evidence that human senior engineers or four active model instances have been assigned.
Responsibilities are split across Staff technical lead, Principal Spine runtime, Staff web/platform, Independent senior release auditor. If only one agent executes, use separate independent verification passes and NEVER claim parallel subagents.

## Release gates (fail closed)
1. Reproduce exact user-reported failing URLs; identify origin, commit, error logs and deterministic minimal fix.
2. Validate complete skeleton + matching atlas + every referenced image page; DXT1/3/5 must decode accurately or return explicit unsupported status. Preserve original confidential assets.
3. Run unit tests AND browser tests on the real latest 10 user items; detect missing texture, 403, broken links, wrong animation, zero-alpha render, mobile failures.
4. Prove animation progression using actual frames. A working ZIP, 200 response, static poster or a green CI alone does not prove playback.
5. Verify real WebM/poster media bytes and decode, per-animation name, metadata, correct source hashes, correct downloads, true editable .spine versus ZIP/JSON.
6. Do not publish NDA assets in logs, screenshots, PR attachments, public repositories or diagnostics.
7. Do not use the user's iMac for editor verification. Use independent native/editor CI and server infrastructure.
8. A successful merge without POST-DEPLOY real-URL verification is NOT a completed fix.
9. Require an independent release audit of code, API authorization, source validation, render and media failures; block release on missing mandatory gates.
10. Report exact commit SHA, real CI URL, live URL and per-record PASS/FAIL/BLOCKED/NOT TESTED; do not claim unknown checks passed.

## Dispatch
Use .github/agents profiles where the actual GitHub Copilot agent feature selects them. Profiles do not automatically create parallel workers or switch model intelligence.
Staff lead triages; Principal Spine checks graphics; Staff platform verifies uploads and web; Independent auditor signs off after real tests.

## Project-specific

Repair latest 10 private source packages. Source-only .skel without atlas/pages fails acceptance. Publish WebM/WebP only after decoding every emitted media file and verifying index URLs.
