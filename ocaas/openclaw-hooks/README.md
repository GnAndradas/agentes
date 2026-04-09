# OCAAS OpenClaw Hooks

Hooks for OpenClaw integration with OCAAS.

## progress-tracker

Passive observability hook that logs runtime events to `runs/<sessionKey>.jsonl`.

### Installation

```bash
# Copy hook to OpenClaw hooks directory
cp -r progress-tracker ~/.openclaw/hooks/

# Or create symlink for development
ln -s $(pwd)/progress-tracker ~/.openclaw/hooks/progress-tracker
```

### Configuration

The hook uses `OPENCLAW_WORKSPACE_PATH` environment variable to determine where to write logs.
Default: `~/.openclaw/workspace`

Logs are written to: `$OPENCLAW_WORKSPACE_PATH/runs/<sessionKey>.jsonl`

### Events Tracked

- `message:received` - User message received
- `message:preprocessed` - Message preprocessed
- `message:sent` - Response sent
- `agent:bootstrap` - Session initialized
- `session:patch` - Session updated
- `tool:call` - Tool invocation started
- `tool:result` - Tool invocation completed

### Important Notes

- This hook is **PASSIVE** - it does NOT modify any data or behavior
- Only logs OCAAS sessions (sessionKey starting with `hook:ocaas:`)
- Does NOT infer tools_used or skills_used
- Observability should never break the system (silent fail on errors)
