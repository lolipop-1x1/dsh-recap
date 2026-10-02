# Changelog

## 0.1.0 — Unreleased

Current-session recap plugin for DeepSeek Harness 0.2.0-rc.2.

- Manual `/recap` and current-visible-session idle recaps, with a default three-minute idle threshold. Opening or switching sessions stays quiet.
- One quiet text row with a three-line preview, expand/collapse and a default 400-character limit. Removed cards, the duplicate composer display and metadata panel.
- Manual commands acknowledge acceptance immediately, clearing submitted input while background generation updates the same row. Repeated calls do not accumulate summaries.
- Manual and automatic summaries share the latest-turn slot; command rows show only the latest help or error note. Automatic recaps add no session events.
- Bounded evidence, independent model generation, labelled factual fallback, cancellation, concurrency control and stale-result protection.
- Cancel automatic work when the final visible tab leaves; continuing the conversation hides the temporary recap. Manual requests sharing automatic work do not create a second preview.
- Native authenticated HTTP, revision-checked settings and legal opt-in model notices; no default context mutation.
- One save button at the settings heading, reload only on failure or conflict, and a secondary restore-defaults action at the bottom.
- Cached recaps reappear only after a new eligible idle trigger or manual request. Turn-window reuse targets the latest display position without changing the original evidence and is labelled as an earlier recap.
- Locale changes update the settings label without remounting the page or discarding unsaved changes.
- Manual requests joining queued automatic work promote that same task ahead of automatic waiters without duplicate generation.
- Removed away, resume, compaction and per-turn triggers. Old fields are accepted and ignored.
- MIT license, bilingual documentation and reproducible build.

Automated validation uses isolated profiles and synthetic model streams (108 tests, 14 browser component checks and 6 real-SDK slot browser regressions). A previous separate live Harness walkthrough verified GPT-6-Luna generation, text rendering, repeat commands, input clearing and new-draft preservation with synthetic conversations. Earlier checks covered quiet session switching, visible-idle generation and continuation hiding. Fresh-profile installation, long-running behavior and other providers remain unverified.
