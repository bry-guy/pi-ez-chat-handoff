import { execFile } from "node:child_process";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { join } from "node:path";
import { promisify } from "node:util";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import type { ResolvedChatChannel } from "./chat-layout.js";

const execFileP = promisify(execFile);

// pi-chat's binding entry. Background workers read this via /--chat-conversation
// flag on spawn, but injecting it makes the session self-identifying too.
const SESSION_STATE_TYPE = "pi-chat-state";

export interface MountOptions {
	channel: ResolvedChatChannel;
	/** Host directory to mount as /workspace. Required. */
	projectDir: string;
	/** If true, also copy ~/.pi/agent/skills/ into <accountDir>/shared/skills/. Default true. */
	mountSkills?: boolean;
	/** If true, replace existing workspace contents. Required when workspace is non-empty. */
	force?: boolean;
	/**
	 * Optional: fork this session file into the channel's tmux-sessions dir so
	 * background workers (/chat-spawn-all) start with this session's history.
	 * Required if the user wants laptop→phone handoff with pi closed.
	 */
	sessionFile?: string;
	/** Cwd to record in the forked session header. Defaults to projectDir. */
	hostCwd?: string;
}

export interface MountResult {
	projectFileCount: number;
	skillsCount: number;
	injectedSessionFile?: string;
	warnings: string[];
}

export async function mountIntoChannel(opts: MountOptions): Promise<MountResult> {
	const warnings: string[] = [];
	const project = resolveAbsolute(opts.projectDir);
	const info = await stat(project).catch(() => undefined);
	if (!info?.isDirectory()) throw new Error(`projectDir is not a directory: ${project}`);

	// Workspace
	await mkdir(opts.channel.workspaceDir, { recursive: true });
	const existing = await readdir(opts.channel.workspaceDir);
	const userContent = existing.filter((n) => n !== "memory.md" && n !== "skills" && n !== "incoming");
	if (userContent.length > 0 && !opts.force) {
		throw new Error(
			`channel workspace is non-empty (${userContent.slice(0, 5).join(", ")}). Pass --force to replace.`,
		);
	}
	if (opts.force && userContent.length > 0) {
		// Replace contents but keep the dir itself (so existing inode/permissions hold).
		for (const name of existing) {
			if (name === "memory.md" || name === "skills" || name === "incoming") continue;
			await rm(join(opts.channel.workspaceDir, name), { recursive: true, force: true });
		}
	}
	// `cp -a project/.` copies contents, including dotfiles like .git
	await execFileP("cp", ["-a", `${project}/.`, opts.channel.workspaceDir]);
	const projectFileCount = await countFiles(opts.channel.workspaceDir);

	// Skills
	let skillsCount = 0;
	const mountSkills = opts.mountSkills ?? true;
	if (mountSkills) {
		const hostSkills = join(homedir(), ".pi", "agent", "skills");
		const hostInfo = await stat(hostSkills).catch(() => undefined);
		if (hostInfo?.isDirectory()) {
			const dest = join(opts.channel.sharedDir, "skills");
			await mkdir(dest, { recursive: true });
			try {
				await execFileP("cp", ["-a", `${hostSkills}/.`, dest]);
				skillsCount = await countFiles(dest);
			} catch (err) {
				warnings.push(`skills copy failed: ${(err as Error).message}`);
			}
		}
	}

	// Session injection (for background-mode handoff)
	let injectedSessionFile: string | undefined;
	if (opts.sessionFile) {
		const srcInfo = await stat(opts.sessionFile).catch(() => undefined);
		if (!srcInfo?.isFile()) {
			throw new Error(`sessionFile is not a regular file: ${opts.sessionFile}`);
		}
		// pi-chat's spawnConversationTmux calls SessionManager.continueRecent(cwd, sessionDir)
		// which picks the most-recent .jsonl in sessionDir. Forking ours in makes it
		// the most-recent, and continueRecent will resume it instead of creating a new
		// blank session.
		await mkdir(opts.channel.sessionDir, { recursive: true });
		const cwd = opts.hostCwd ?? project;
		const sm = SessionManager.forkFrom(opts.sessionFile, cwd, opts.channel.sessionDir);
		const newFile = sm.getSessionFile();
		if (!newFile) throw new Error("forkFrom did not produce a session file");
		// Belt-and-suspenders: pi-chat also passes --chat-conversation on spawn, so
		// this entry is redundant for newly-spawned workers. But it makes the file
		// self-identifying for any tool that scans it later.
		sm.appendCustomEntry(SESSION_STATE_TYPE, { conversationId: opts.channel.conversationId });
		sm.appendSessionInfo(`pi-chat ${opts.channel.conversationName} (handed off)`);
		injectedSessionFile = newFile;
	}

	return { projectFileCount, skillsCount, injectedSessionFile, warnings };
}

function resolveAbsolute(p: string): string {
	const trimmed = p.trim();
	if (!trimmed) throw new Error("path is empty");
	return isAbsolute(trimmed) ? trimmed : resolvePath(process.cwd(), trimmed);
}

async function countFiles(dir: string): Promise<number> {
	let n = 0;
	async function walk(current: string): Promise<void> {
		const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
		for (const e of entries) {
			if (e.isDirectory()) await walk(join(current, e.name));
			else n++;
		}
	}
	await walk(dir);
	return n;
}
