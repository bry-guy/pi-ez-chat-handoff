import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { listChannels, loadChatConfig, resolveChannelById, type ResolvedChatChannel } from "./src/chat-layout.js";
import { mountIntoChannel } from "./src/mount.js";

interface ParsedArgs {
	conversationId?: string;
	projectDir?: string;
	noSkills: boolean;
	force: boolean;
	background: boolean;
}

function tokenize(raw: string): string[] {
	const tokens = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
	return tokens.map((t) => t.replace(/^["']|["']$/g, ""));
}

function parseArgs(raw: string): ParsedArgs {
	const tokens = tokenize(raw);
	const positional: string[] = [];
	const out: ParsedArgs = { noSkills: false, force: false, background: false };
	for (const t of tokens) {
		if (t === "--no-skills") out.noSkills = true;
		else if (t === "--force" || t === "-f") out.force = true;
		else if (t === "--background" || t === "--bg") out.background = true;
		else if (t.startsWith("--project=")) out.projectDir = t.slice("--project=".length);
		else if (t.startsWith("--channel=")) out.conversationId = t.slice("--channel=".length);
		else if (t.startsWith("-")) throw new Error(`unknown flag: ${t}`);
		else positional.push(t);
	}
	if (positional[0] && !out.conversationId) out.conversationId = positional[0];
	if (positional[1] && !out.projectDir) out.projectDir = positional[1];
	return out;
}

const USAGE = [
	"Usage: /chat-ez-handoff [<accountId/channelKey>] [<project-dir>] [flags]",
	"",
	"Mounts a project directory into a pi-chat channel's workspace and copies",
	"host skills into the account's shared skills dir.",
	"",
	"Default (foreground) mode: after this, run /chat-connect <channel>. pi-chat",
	"attaches your current pi session to the channel — your conversation history",
	"comes along automatically because the session lives in your pi process.",
	"",
	"--background mode: also forks your current session into the channel's",
	"tmux-sessions dir, so /chat-spawn-all picks it up. Use this when you want",
	"to close pi entirely and continue from Discord.",
	"",
	"Flags:",
	"  --project=<dir>   project directory to mount (default: current cwd).",
	"  --channel=<id>    target channel (alternative to positional arg).",
	"  --no-skills       skip copying ~/.pi/agent/skills/ into shared/skills/.",
	"  --background      also inject current session into tmux-sessions dir for",
	"                    background workers. Required for /chat-spawn-all.",
	"  --force           replace non-empty channel workspace.",
].join("\n");

async function selectChannel(
	ctx: ExtensionCommandContext,
	channels: ResolvedChatChannel[],
): Promise<ResolvedChatChannel | undefined> {
	if (channels.length === 0) {
		ctx.ui.notify("No pi-chat channels configured. Run /chat-config first.", "warning");
		return undefined;
	}
	if (!ctx.hasUI) {
		ctx.ui.notify(USAGE, "warning");
		return undefined;
	}
	const labels = channels.map((c) => `${c.conversationName}  (${c.conversationId})`);
	const choice = await ctx.ui.select("Hand off to which channel?", labels);
	if (!choice) return undefined;
	const idx = labels.indexOf(choice);
	return idx >= 0 ? channels[idx] : undefined;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("chat-ez-handoff", {
		description: "Hand off the current pi session to a pi-chat channel (mount project + skills, then connect)",
		handler: async (raw, ctx) => {
			let args: ParsedArgs;
			try {
				args = parseArgs(raw);
			} catch (err) {
				ctx.ui.notify(`${(err as Error).message}\n\n${USAGE}`, "error");
				return;
			}

			const config = await loadChatConfig();
			let channel: ResolvedChatChannel | undefined;
			if (args.conversationId) {
				channel = resolveChannelById(config, args.conversationId);
				if (!channel) {
					ctx.ui.notify(`No pi-chat channel matches "${args.conversationId}".`, "error");
					return;
				}
			} else {
				channel = await selectChannel(ctx, listChannels(config));
				if (!channel) return;
			}

			const projectDir = args.projectDir ?? ctx.cwd;

			try {
				const sessionFile = args.background ? ctx.sessionManager.getSessionFile() ?? undefined : undefined;
				if (args.background && !sessionFile) {
					ctx.ui.notify(
						"--background requested but no current session file detected. " +
							"This pi must be running with --session for handoff to background to carry your history.",
						"error",
					);
					return;
				}

				const result = await mountIntoChannel({
					channel,
					projectDir,
					mountSkills: !args.noSkills,
					force: args.force,
					sessionFile,
					hostCwd: projectDir,
				});
				const lines = [
					`Mounted ${projectDir} → ${channel.conversationName}`,
					`  workspace files: ${result.projectFileCount}`,
				];
				if (result.skillsCount > 0) lines.push(`  skills mounted: ${result.skillsCount}`);
				if (result.injectedSessionFile) {
					lines.push(`  session injected: ${result.injectedSessionFile}`);
				}
				for (const w of result.warnings) lines.push(`  warning: ${w}`);
				lines.push("");
				if (args.background) {
					lines.push(`Now run: /chat-spawn-all   (or --restart if a worker is already running)`);
				} else {
					lines.push(`Now run: /chat-connect ${channel.conversationId}`);
				}
				ctx.ui.notify(lines.join("\n"), "info");
			} catch (err) {
				ctx.ui.notify((err as Error).message, "error");
			}
		},
	});
}
