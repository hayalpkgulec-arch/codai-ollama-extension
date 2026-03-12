# Requirements

## Goals

- WHEN we continue building CodAI THE SYSTEM SHALL keep a persistent, prioritized backlog for the next agentic architecture milestones.
- WHEN a milestone is implemented THE SYSTEM SHALL preserve runtime reliability, provider compatibility, and local-first observability.
- WHEN long-running tasks use tools, web, or browser automation THE SYSTEM SHALL keep the execution path inspectable and recoverable.

## Acceptance Criteria

- [ ] The backlog is grouped by release milestone from `0.0.50` to `0.0.54`
- [ ] Each milestone has concrete deliverables, test gates, and hardening targets
- [ ] P0 work covers browser session, tool hardening, UI/store split, and goal control
- [ ] The backlog lives inside `.codai/plans` so it can stay aligned with the extension's planning workflow

## Progress Notes

- 2026-03-13: Started implementing the P0 web-tool hardening milestone. The runtime now preserves structured web-source provenance and guards against repetitive, low-signal search/fetch patterns before the model sees them.
- 2026-03-13: Finished the first milestone slice end-to-end. Structured web results now have dedicated UI, and regression coverage exists for the failure shapes that previously made tool behavior brittle.
- 2026-03-13: Finished the browser-session milestone slice end-to-end. The agent can now open a local browser session through dedicated tools, persist screenshot and console artifacts per session, surface browser state in runtime/debug views, and recover cleanly from browser crashes without poisoning later turns.
