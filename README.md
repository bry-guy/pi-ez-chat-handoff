# pi-ez-chat-handoff

`pi-ez-chat-handoff` lets you take the pi session you are using locally and continue it from a `pi-chat` channel such as Discord or Telegram.

Use it when you have already started useful work in a local pi session and decide: “I want this exact project, skills, and session context available from chat.”

## What you get

- `/chat-ez-handoff` slash command inside pi.
- Copies your current project into the target pi-chat channel workspace.
- Copies your local pi skills into the account shared skills directory.
- Supports a foreground handoff to `/chat-connect`.
- Supports a background handoff to `/chat-spawn-all` so you can close the local pi process.
- Keeps pi-chat workspace files such as `memory.md`, `skills/`, and `incoming/` safe during forced replacement.

## Install

```bash
pi install git:github.com/bry-guy/pi-ez-chat-handoff@v0.1.0
```

Or track the default branch:

```bash
pi install git:github.com/bry-guy/pi-ez-chat-handoff
```

If pi is already running, run `/reload` after installing.

## Before you start

Configure `pi-chat` first:

1. Install and configure `pi-chat`.
2. Run `/chat-config`.
3. Add your Discord or Telegram account.
4. Configure at least one channel.

This package does not replace pi-chat setup. It prepares a channel workspace and, optionally, a background worker session.

## Quick start: keep this pi open

From the local pi session you want to hand off:

```text
/chat-ez-handoff my_bot/dev
```

Then connect the same pi session to chat:

```text
/chat-connect my_bot/dev
```

Now messages in that Discord/Telegram channel talk to this running pi session. Your conversation history is still here because the local pi process is still the process answering.

Use this mode when your laptop or tmux session will stay alive.

## Background mode: close pi and continue from chat

If you want the chat channel to keep working after this local pi exits:

```text
/chat-ez-handoff my_bot/dev --background
/chat-spawn-all
```

Background mode also forks the current session into pi-chat's tmux worker session directory. `/chat-spawn-all` then starts a detached worker that resumes that fork.

Use this mode when you want true async chat access from another device.

## Pick a channel interactively

If you omit the channel and pi has an interactive UI, the command prompts you:

```text
/chat-ez-handoff
```

In non-interactive contexts, pass the channel explicitly:

```text
/chat-ez-handoff account/channel
```

## Hand off a different project directory

By default, the command copies pi's current working directory. To hand off a different directory:

```text
/chat-ez-handoff my_bot/dev --project=/path/to/project
```

Equivalent positional form:

```text
/chat-ez-handoff my_bot/dev /path/to/project
```

## Replace an existing channel workspace

The command refuses to overwrite a non-empty workspace unless you pass `--force`:

```text
/chat-ez-handoff my_bot/dev --force
```

`--force` removes ordinary project files from the target workspace and recopies the project. It preserves pi-chat's own workspace artifacts:

- `memory.md`
- `skills/`
- `incoming/`

## Skip skill copying

By default, local skills from `~/.pi/agent/skills/` are copied into the pi-chat account shared skills directory.

Skip that if the account already has curated shared skills:

```text
/chat-ez-handoff my_bot/dev --no-skills
```

## Command reference

```text
/chat-ez-handoff [<account/channel>] [<project-dir>] [flags]
```

Flags:

- `--project=<dir>` — project directory to copy; defaults to pi's current cwd.
- `--channel=<account/channel>` — target channel; alternative to the positional channel.
- `--no-skills` — do not copy `~/.pi/agent/skills/` into shared skills.
- `--background`, `--bg` — fork the current session for pi-chat tmux workers.
- `--force`, `-f` — replace non-empty workspace contents, preserving pi-chat artifacts.

## Foreground versus background

| Question | Foreground | Background |
|---|---|---|
| Can I close local pi? | No | Yes, after `/chat-spawn-all` |
| Carries current conversation? | Yes, same process | Yes, forked session file |
| Best for | quick handoff | durable remote worker |
| Next command | `/chat-connect <channel>` | `/chat-spawn-all` |

## How it works

pi-chat mounts each channel workspace into a Gondolin VM at `/workspace` and account shared storage at `/shared`.

This package prepares those directories:

1. Copies the project into `~/.pi/agent/chat/accounts/<account>/channels/<channel>/workspace/`.
2. Copies local skills into `~/.pi/agent/chat/accounts/<account>/shared/skills/` unless skipped.
3. In background mode, forks the current pi session into `~/.pi/agent/chat/tmux-sessions/<worker>/` and records the pi-chat conversation id.

No build step is required; pi loads the TypeScript extension directly.

## Related package: persistent Discord threads

If you want each Discord thread to become its own named, persistent pi session, use:

```bash
pi install git:github.com/bry-guy/pi-ez-chat-threads
```

`pi-ez-chat-handoff` is for moving a local session into a channel. `pi-ez-chat-threads` is for creating durable thread-specific sessions from an already-connected Discord channel.

## Development

```bash
npm ci
npm run check          # typecheck + tests
npm pack --dry-run     # inspect publishable files
```

## License

MIT
