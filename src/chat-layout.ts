import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Constants duplicated from pi-chat src. MUST stay in sync if pi-chat changes its layout.
const CHAT_HOME = join(homedir(), ".pi", "agent", "chat");
const CHAT_CONFIG_PATH = join(CHAT_HOME, "config.json");
const WORKER_TMUX_PREFIX = "pi-chat-worker-";

function sanitizePathSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function tmuxSafeName(value: string): string {
	const safe = value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "channel";
	return `${WORKER_TMUX_PREFIX}${safe}`.slice(0, 100);
}

export interface ResolvedChatChannel {
	conversationId: string;
	conversationName: string;
	accountId: string;
	channelKey: string;
	workspaceDir: string;
	sharedDir: string;
	sessionDir: string;
	tmuxName: string;
}

interface RawConfig {
	accounts?: Record<
		string,
		{
			name?: string;
			service?: string;
			channels?: Record<string, { name?: string }>;
		}
	>;
}

export const CHAT_CONFIG_FILE = CHAT_CONFIG_PATH;

export async function loadChatConfig(): Promise<RawConfig> {
	try {
		const raw = await readFile(CHAT_CONFIG_PATH, "utf8");
		return JSON.parse(raw) as RawConfig;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return { accounts: {} };
		throw err;
	}
}

export function listChannels(config: RawConfig): ResolvedChatChannel[] {
	const out: ResolvedChatChannel[] = [];
	for (const [accountId, account] of Object.entries(config.accounts ?? {})) {
		for (const [channelKey, channel] of Object.entries(account.channels ?? {})) {
			out.push(resolveChannel(accountId, channelKey, account.name, channel.name));
		}
	}
	return out;
}

export function resolveChannelById(config: RawConfig, conversationId: string): ResolvedChatChannel | undefined {
	const slash = conversationId.indexOf("/");
	if (slash === -1) return undefined;
	const accountId = conversationId.slice(0, slash);
	const channelKey = conversationId.slice(slash + 1);
	const account = config.accounts?.[accountId];
	const channel = account?.channels?.[channelKey];
	if (!account || !channel) return undefined;
	return resolveChannel(accountId, channelKey, account.name, channel.name);
}

function resolveChannel(
	accountId: string,
	channelKey: string,
	accountName: string | undefined,
	channelName: string | undefined,
): ResolvedChatChannel {
	const conversationId = `${accountId}/${channelKey}`;
	const accountDir = join(CHAT_HOME, "accounts", sanitizePathSegment(accountId));
	const channelDir = join(accountDir, "channels", sanitizePathSegment(channelKey));
	const tmuxName = tmuxSafeName(conversationId);
	return {
		conversationId,
		conversationName: `${accountName ?? accountId} / ${channelName ?? channelKey}`,
		accountId,
		channelKey,
		workspaceDir: join(channelDir, "workspace"),
		sharedDir: join(accountDir, "shared"),
		sessionDir: join(CHAT_HOME, "tmux-sessions", tmuxName),
		tmuxName,
	};
}
