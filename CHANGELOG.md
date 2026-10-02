# Changelog

## 0.1.0 — Unreleased

Current-session recap plugin for DeepSeek Harness 0.2.0-rc.2.

- Manual `/recap` and current-visible-session idle recaps, with a default three-minute idle threshold. Opening or switching sessions stays quiet.
- One quiet text row with a three-line preview, expand/collapse and a default target of 160 characters. Removed cards, the duplicate composer display and metadata panel.
- Manual commands acknowledge acceptance immediately, clearing submitted input while background generation updates the same row. Repeated calls do not accumulate summaries.
- Manual summaries use the latest command row; automatic summaries use the turn tail when no eligible command row exists. Automatic recaps add no session events.
- Bounded evidence, independent model generation, explicit failure feedback preserving the previous recap, cancellation, concurrency control and stale-result protection.
- Cancel automatic work when the final visible tab leaves; continuing the conversation hides the temporary recap. Manual requests sharing automatic work do not create a second preview.
- Native authenticated HTTP, revision-checked settings and legal opt-in model notices; no default context mutation.
- Automatic revision-checked saves survive panel closure, with retained conflict drafts and explicit retry. Advanced options are collapsed.
- Refreshed pages do not reveal an old recap through automatic cache reuse; manual requests can reveal it. Turn-window reuse targets the latest display position without changing the original evidence and is labelled as an earlier recap.
- Locale changes update the settings label without remounting the page or discarding unsaved changes.
- Manual requests joining queued automatic work promote that same task ahead of automatic waiters without duplicate generation.
- Removed away, resume, compaction and per-turn triggers. Old fields are accepted and ignored.
- MIT license, bilingual documentation and reproducible build.

Automated validation uses isolated profiles and synthetic model streams (138 tests, 20 browser component checks and 7 real-SDK slot browser regressions). A previous separate live Harness walkthrough verified GPT-6-Luna generation, text rendering, repeat commands, input clearing and new-draft preservation with synthetic conversations. Earlier checks covered quiet session switching, visible-idle generation and continuation hiding. Fresh-profile installation, long-running behavior and other providers remain unverified.

- Removed the confusing file-path switch and separate file-list collection; old boolean configuration remains readable.
- Added a settings dialog opened directly by the command, visible expansion control and per-page recap presentation state. `status` is read-only.

- Added blank-session command feedback through the public input dock, verified in the restarted Harness alongside direct settings dialogs, real model generation, timeout/retry and per-page refresh behavior.

- Keep the recap anchored to its summary command when settings, status or help commands run, preserving its position below Compact.
