# pi-ez-chat-handoff

Hand off your current pi session to a pi-chat channel so you can continue working from Discord/Telegram.

## What's the problem?

`/chat-connect` in pi-chat already does almost everything you want — attaches the current pi session to a channel, spins up a fresh Gondolin VM with `/workspace` mounted from the channel's workspace dir, pipes messages back and forth.

What's missing: the channel's workspace dir is empty (no project files), and the VM doesn't have your host's `~/.pi/agent/skills/`. So even though your session history is there, the agent can't operate on your repo.

This extension fixes that with one command.

## Usage

```
/chat-ez-handoff [<accountId/channelKey>] [<project-dir>] [flags]
```

Defaults: channel selected interactively if omitted, project dir is current cwd, skills copied automatically.

Flags:
- `--project=<dir>` — project to mount (default: current cwd)
- `--channel=<id>` — target channel (alternative to positional)
- `--no-skills` — skip copying `~/.pi/agent/skills/` to `<account>/shared/skills/`
- `--background`, `--bg` — also fork current session into channel's tmux-sessions dir so `/chat-spawn-all` workers pick it up
- `--force` — replace non-empty channel workspace (preserves pi-chat's `memory.md`, `skills/`, `incoming/`)

## Two handoff modes

### Foreground (default) — pi stays running

```bash
# At your laptop, in a pi-gondolin session against /home/bryan/code/foo:
/chat-ez-handoff my_bot/dev
# Mounted /home/bryan/code/foo → my_bot / dev
#   workspace files: 87
#   skills mounted: 14
# Now run: /chat-connect my_bot/dev

/chat-connect my_bot/dev
```

pi-chat attaches **your current pi session** to the channel. Conversation history is automatically present because it lives in your running pi process. The VM mounts the populated workspace at `/workspace`. Messages from Discord get answered by your foreground session.

This works as long as pi stays open. Run pi inside tmux on a homelab and you can come back to it from anywhere via Tailscale.

### Background (`--background`) — pi can close

```bash
/chat-ez-handoff my_bot/dev --background
# Mounted ...
#   session injected: ~/.pi/agent/chat/tmux-sessions/pi-chat-worker-my_bot_dev/<timestamp>_<uuid>.jsonl
# Now run: /chat-spawn-all

/chat-spawn-all
```

pi-chat's `/chat-spawn-all` starts a detached tmux session per channel, each running its own pi worker. Each worker calls `SessionManager.continueRecent(cwd, tmux-sessions-dir)` to find a session — `--background` forks your current session into that dir so the worker picks it up.

After `/chat-spawn-all` you can close your foreground pi entirely. The workers keep running, your Discord channel is responsive, and the model has full prior context.

## Picking a mode

| | Foreground | Background |
|--|--|--|
| pi must stay running | yes | no |
| conversation history carried | automatically | via session fork |
| number of channels | 1 at a time | all configured |
| use when | laptop nearby, occasional Discord | leaving the machine, true async work |

## How it works

The whole thing is ~250 lines. The interesting bit is what we *don't* do in foreground mode:

- **We don't fork or copy session files.** pi-chat's `/chat-connect` attaches the channel to whichever session your pi process is running. Just put project files where pi-chat will mount them, and run `/chat-connect`.
- **We don't manage Gondolin VMs.** pi-chat does that. `/chat-connect` calls `prepareGondolin` and `ConversationSandbox.start()` which mount `<channel>/workspace` at `/workspace` and `<account>/shared` at `/shared`.

What we do in foreground:
1. `cp -a <projectDir>/. <accountDir>/channels/<chanKey>/workspace/`
2. `cp -a ~/.pi/agent/skills/. <accountDir>/shared/skills/`

In `--background` we additionally:

3. `SessionManager.forkFrom(currentSession, projectDir, <chat-home>/tmux-sessions/<sanitized-id>/)`

so that pi-chat's `spawnConversationTmux` finds our forked file as the most-recent when it calls `continueRecent`.

## Package and releases

This repository is a git-installable pi package. The `package.json` `pi` manifest exposes `./index.ts` as the extension entrypoint; pi loads TypeScript directly, so there is no build artifact to publish.

Releases use the same lightweight GitHub flow as the other `bry-guy/pi-ez-*` packages:

- CI runs `mise run check` on pushes and PRs.
- PR titles should be Conventional Commits (`feat:`, `fix:`, etc.).
- release-please opens release PRs and creates semver GitHub releases/tags after merge.

Repository settings still need to allow/prefer squash merges; the workflow files document the flow but do not change GitHub UI settings by themselves.

## Limitations

- **Skills are merged with overwrite-wins.** Host skills overlay any existing files in the account's `shared/skills/`. Use `--no-skills` if you've curated channel-specific skills there.
- **Custom Gondolin images aren't propagated.** pi-chat hardcodes its image at `VM.create()` time. If your laptop session ran a custom image (e.g. with `mise`), the handoff VM won't have it. Workarounds: set `GONDOLIN_DEFAULT_IMAGE` globally, or record setup steps in `<project>/SYSTEM.md`.
- **`--background` requires an assistant turn in the source session.** SessionManager only flushes appended entries to disk after the first assistant message. The forked file's pre-existing entries (from your source session) come along regardless because `forkFrom` writes them synchronously. The pi-chat binding entry that this extension appends won't persist if there's no assistant turn yet — but it doesn't need to, because pi-chat's `--chat-conversation` flag (always passed on background spawn) takes precedence over the in-session binding entry. So this is a latent quirk that doesn't affect behavior.
- **Storage layout is replicated from pi-chat.** `src/chat-layout.ts` mirrors pi-chat's constants. Re-verify against pi-chat HEAD periodically.

## Install

```bash
pi install git:github.com/bry-guy/pi-ez-chat-handoff@v0.1.0
# or track the default branch
pi install git:github.com/bry-guy/pi-ez-chat-handoff
# or load ephemerally
pi -e git:github.com/bry-guy/pi-ez-chat-handoff
```

## Development

```bash
npm ci
npm run check                 # typecheck + 23 tests
npm pack --dry-run            # inspect publishable files
```

## License

MIT
