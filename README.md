# DSH Recap

**Return to your work without losing the thread.**

[简体中文](README.zh-CN.md) · [Configuration](docs/配置说明.md) · [Repository](https://github.com/lolipop-1x1/dsh-recap)

An unofficial current-session recap plugin for **DeepSeek Harness 0.2.0-rc.2**. A quiet `›recap ·` text row in the chat summarizes the task, observed progress and recorded next step. It defaults to a 400-character limit and a three-line preview, with expand/collapse for the full text. It is not cross-session memory and does not modify the main model context by default.

## Install

Node.js 22.19 or newer is required. From this checkout:

```sh
npm ci --ignore-scripts
npm run build
npm pack
```

In Harness **Creator mode**, ask `plugin_manager` to `install_bundle` with the absolute path of this built workspace as `target`. The package declares its bundle patch and Client entry. Do not manually edit profile configuration or Harness source. Disable an existing plugin that already owns `/recap`, then refresh the browser after installation. Configuration is available under **Settings → Recap**.

`npm pack` creates `dsh-recap-0.1.0.tgz` for distribution. This package has **not** been published to npm. Confirm package-name ownership before publishing; use your own scope when appropriate and update the bundle patch, Client module identity and release checks consistently.

## Commands

`/recap` generates or reuses a recap. `/recap refresh` forces regeneration, including a retry after a model failure. `/recap hide` hides the current recap and pauses automatic recaps for this session until a manual request. `/recap status` reveals the existing recap without generating. `/recap settings` explains where to configure the plugin; `/recap help` lists the commands.

The command acknowledges acceptance immediately, allowing Harness to clear the submitted input while generation continues. A later result updates the same recap row without touching a new draft. Repeated requests share in-flight work or reuse an unchanged result; a refresh replaces the current recap. Acceptance does not mean that model generation has finished.

## Triggers and evidence

| Trigger                      | Default       | Behavior                                                                 |
| ---------------------------- | ------------- | ------------------------------------------------------------------------ |
| Manual `/recap`              | Available     | Bypasses automatic switches and the minimum turn count                   |
| Current visible session idle | On, 3 minutes | Keyboard, pointer and scroll activity reset the timer; heartbeats do not |

Opening or switching sessions does not generate a recap. Automatic recaps require three meaningful completed turns, a visible loaded top-level session and an idle agent. A busy agent starts a fresh idle period when its turn finishes. Leaving the last visible tab cancels automatic work and hides its temporary result.

Manual and automatic results share one expandable text row at the latest turn. They do not accumulate as command cards. Continuing the conversation or switching sessions hides the temporary recap. Command history records acceptance or status, rather than a separate copy of the summary; automatic results add no session event. Model output is one or two short sentences; factual fallback uses recorded tasks without copying the last reply. Earlier tool errors are not presented as unresolved blockers, and a proposed action is not claimed as completed.

## Privacy, cost and failure behavior

By default there are no model-facing tools, extra third-party endpoints, workspace file reads or main-context injection. `hybrid` uses a separate request through your configured provider; it still consumes provider credits and shares rate limits. `deterministic` extracts facts without a model call.

Reasoning blocks, images, tool arguments and large successful tool outputs are excluded from recap input. Common credential patterns are scrubbed, but this is **not complete DLP**: private conversation content may still reach the provider you selected. Disabling file paths removes the separate file list, not every path mentioned in conversation text.

Generated recap caches live in memory. Harness can still persist its original session logs, human command results and bounded projection checkpoints. Enabling context injection writes a durable notice into the main conversation. This plugin is not a no-disk-traces privacy boundary.

Concurrent work is deduplicated per session and globally limited. New activity, configuration changes, dismissal and disposal invalidate old tasks. Late results cannot overwrite newer state. Timeouts, empty output and incomplete streams fall back to explicitly labelled extracted facts. Changed facts are summarized at the next eligible idle period; an optional cache window can reuse older results. `/recap refresh` requests a fresh attempt.

Automatic recaps require a running Host and browser presence heartbeats. Sleep, disconnection and Host shutdown prevent automatic work. Old away, resume, compaction and per-turn settings are accepted but ignored; there are only manual and visible-idle triggers.

## Development

Run `npm run check`, `npm run format:check` and `npm run test:browser` before submitting a change. Tests cover factual extraction, scheduling, authenticated HTTP, Harness integration, settings persistence and client registration. They use isolated profiles and synthetic model streams. The browser component fixture checks three-line wrapping, expand/collapse, silent loading failures, continuation hiding, settings conflicts, language switching, narrow layouts and unmount cleanup.

Browser checks use installed Chrome on macOS, `CHROME_PATH` when provided, or Playwright Chromium (`npx playwright install chromium`). The component fixture does not verify installation or end-to-end behavior in a real Harness profile.

Architecture and validation notes are kept in the source checkout’s `docs/` directory. A separate live Harness 0.2.0-rc.2 walkthrough with synthetic conversations verified GPT-6-Luna generation, the text row, repeated commands, immediate input clearing and preservation of a new draft. Earlier checks covered silent session switching, visible-idle behavior, factual fallback, settings conflicts and opt-in context injection. See `docs/验证说明.md` for coverage and remaining limits. For bug reports, include versions and a minimal reproduction with synthetic data; keep credentials and private conversation content out of public issues.

`src/core` contains bounded facts and scheduling, `src/host` adapts real Harness services, and `src/client` integrates native slots and settings. MIT licensed; not affiliated with or endorsed by DeepSeek or Anthropic.
