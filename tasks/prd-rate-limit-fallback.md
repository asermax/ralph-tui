# PRD: Rate Limit Fallback

## Introduction

Add automatic agent switching when the primary agent hits rate limits. When Claude Code encounters rate limiting, ralph-tui should automatically fall back to a configured backup agent (e.g., OpenCode) to continue execution without manual intervention. Once the current iteration completes on the fallback agent, subsequent iterations attempt to switch back to the primary agent.

This ensures continuous progress on tasks even when API rate limits are encountered, maximizing productivity during autonomous execution sessions.

## Goals

- Detect rate limit conditions from agent output (stderr messages, exit codes)
- Automatically switch to a fallback agent when rate limits are hit
- Continue current iteration on fallback agent until completion
- Attempt to restore primary agent for subsequent iterations
- Provide clear visibility into which agent is currently active and why
- Support smart agent prioritization based on capability matching

## User Stories

### US-001: Configure fallback agents in config
**Description:** As a user, I want to configure a prioritized list of fallback agents so ralph-tui knows which agents to try when my primary hits rate limits.

**Acceptance Criteria:**
- [ ] Add `fallbackAgents` array to agent config section
- [ ] Each entry specifies agent plugin name (e.g., "opencode", "claude")
- [ ] Order determines priority (first fallback tried first)
- [ ] Config validation warns if fallback agent not installed/available
- [ ] Example config in docs/README
- [ ] bun run typecheck passes

### US-002: Detect rate limit from agent output
**Description:** As the engine, I need to detect when an agent has hit rate limits so I can trigger fallback behavior.

**Acceptance Criteria:**
- [ ] Parse stderr for common rate limit messages ("rate limit", "429", "too many requests")
- [ ] Detect non-zero exit codes combined with rate limit indicators
- [ ] Create `RateLimitDetector` utility with agent-specific patterns
- [ ] Claude patterns: "rate limit exceeded", "overloaded", HTTP 429
- [ ] OpenCode patterns: provider-specific rate limit messages
- [ ] Return structured result: `{ isRateLimit: boolean, message?: string, retryAfter?: number }`
- [ ] bun run typecheck passes

### US-003: Implement retry with exponential backoff
**Description:** As the engine, I want to retry with backoff before switching agents, in case the rate limit is brief.

**Acceptance Criteria:**
- [ ] On rate limit detection, wait and retry (not immediate fallback)
- [ ] Exponential backoff: 5s, 15s, 45s (configurable base/max)
- [ ] Maximum 3 retry attempts before triggering fallback
- [ ] If `retryAfter` header/message detected, use that duration
- [ ] Log retry attempts with remaining count
- [ ] bun run typecheck passes

### US-004: Switch to fallback agent on persistent rate limit
**Description:** As the engine, I need to switch to a fallback agent when retries are exhausted so execution can continue.

**Acceptance Criteria:**
- [ ] After retry exhaustion, select next available fallback agent
- [ ] Initialize fallback agent with same config/options as primary
- [ ] Transfer current task context to fallback agent
- [ ] Continue current iteration on fallback agent
- [ ] If all fallback agents exhausted, pause and notify user
- [ ] bun run typecheck passes

### US-005: Track active agent state in engine
**Description:** As the engine, I need to track which agent is currently active and why, so the TUI can display accurate status.

**Acceptance Criteria:**
- [ ] Add `activeAgent` to engine state: `{ plugin: string, reason: 'primary' | 'fallback', since: Date }`
- [ ] Add `rateLimitState` tracking: `{ primaryAgent: string, limitedAt?: Date, fallbackAgent?: string }`
- [ ] Emit state change events when agent switches
- [ ] State persists across iterations (until primary recovered)
- [ ] bun run typecheck passes

### US-006: Display active agent and fallback status in TUI
**Description:** As a user, I want to see which agent is currently active and whether I'm on a fallback so I understand the current execution state.

**Acceptance Criteria:**
- [ ] Top bar shows active agent name (existing, from US-tzw.9)
- [ ] When on fallback, show indicator: "opencode (fallback)"
- [ ] Show rate limit icon/badge when primary is limited
- [ ] Tooltip or detail shows: "Primary (claude) rate limited at HH:MM, using fallback"
- [ ] bun run typecheck passes
- [ ] Verify in TUI manually

### US-007: Attempt primary agent recovery between iterations
**Description:** As the engine, I want to try switching back to the primary agent at the start of each new iteration so I use the preferred agent when available.

**Acceptance Criteria:**
- [ ] At iteration start, if on fallback, attempt primary agent
- [ ] Use short timeout for primary test (5s) to avoid delays
- [ ] If primary succeeds, switch back and clear fallback state
- [ ] If primary still limited, continue on fallback
- [ ] Log recovery attempts and outcomes
- [ ] Configurable: `recoverPrimaryBetweenIterations: boolean` (default true)
- [ ] bun run typecheck passes

### US-008: Log agent switches to iteration output
**Description:** As a user reviewing logs, I want to see when and why agent switches occurred so I can understand execution history.

**Acceptance Criteria:**
- [ ] Log entry when switching to fallback: timestamp, reason, from/to agents
- [ ] Log entry when recovering to primary: timestamp, duration on fallback
- [ ] Include in iteration log metadata: `agentSwitches: [{ at, from, to, reason }]`
- [ ] Summary in iteration completion: "Completed on fallback (opencode) due to rate limit"
- [ ] bun run typecheck passes

## Functional Requirements

- FR-1: Support configuring ordered list of fallback agents in ralph-tui config
- FR-2: Detect rate limits from agent stderr output and exit codes
- FR-3: Implement exponential backoff retry before fallback (3 attempts, 5s/15s/45s)
- FR-4: Switch to next available fallback agent when retries exhausted
- FR-5: Track active agent state with reason (primary vs fallback)
- FR-6: Display fallback status clearly in TUI header
- FR-7: Attempt primary agent recovery at start of each new iteration
- FR-8: Log all agent switches with timestamps and reasons
- FR-9: Pause and notify user if all agents (primary + fallbacks) are rate limited

## Non-Goals

- No automatic agent installation (fallbacks must be pre-configured)
- No model fallback within same agent (e.g., opus → sonnet) - that's agent-internal
- No cost optimization based on agent pricing
- No predictive rate limit avoidance
- No rate limit pooling across multiple API keys

## Technical Considerations

### Rate Limit Detection Patterns

```typescript
// Claude Code patterns
const CLAUDE_RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /too many requests/i,
  /429/,
  /overloaded/i,
  /capacity/i,
];

// OpenCode patterns (varies by provider)
const OPENCODE_RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /quota exceeded/i,
  /429/,
];
```

### Config Schema Addition

```toml
[agent]
plugin = "claude"
fallbackAgents = ["opencode"]  # Ordered priority list

[agent.rateLimitHandling]
enabled = true
maxRetries = 3
baseBackoffMs = 5000
recoverPrimaryBetweenIterations = true
```

### State Management

Agent state should be:
- Stored in engine iteration state
- Emitted via events for TUI updates
- Logged to iteration output for history
- Reset when user explicitly restarts

### Existing Components to Modify

- `src/engine/index.ts` - Add fallback logic to execution loop
- `src/plugins/agents/base.ts` - Add rate limit detection hook
- `src/config/types.ts` - Add fallback config types
- `src/tui/components/Header.tsx` - Show fallback indicator
- `src/logs/persistence.ts` - Include agent switch history

## Success Metrics

- Rate limit events don't halt autonomous execution (fallback kicks in)
- User sees clear indication when running on fallback agent
- Primary agent automatically recovers when limits reset
- No manual intervention required for rate limit handling
- Iteration logs capture full agent switch history

## Open Questions

1. Should we support different fallback agents per task type (e.g., complex tasks stay on Claude)?
2. What's the optimal "primary recovery test" approach - full prompt or lightweight ping?
3. Should fallback agent config include model overrides (e.g., use sonnet on opencode)?
4. How long should we wait before attempting primary recovery (time-based vs iteration-based)?
