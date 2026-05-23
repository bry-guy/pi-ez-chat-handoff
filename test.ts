import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { loadChatConfig, resolveChannelById } from "./src/chat-layout.js";
import { mountIntoChannel } from "./src/mount.js";

interface TR { name: string; ok: boolean; details?: string; }
const results: TR[] = [];
function check(name: string, ok: boolean, details?: string) { results.push({ name, ok, details }); }

const TEST_ACCOUNT = "test_acct";
const TEST_CHANNEL = "test_chan";
const CONV_ID = `${TEST_ACCOUNT}/${TEST_CHANNEL}`;
const CHAT_HOME = join(homedir(), ".pi", "agent", "chat");
const CHAT_CONFIG_PATH = join(CHAT_HOME, "config.json");
const HOST_SKILLS = join(homedir(), ".pi", "agent", "skills");

async function main() {
	const configBackup = await readFile(CHAT_CONFIG_PATH, "utf8").catch(() => undefined);
	const hostSkillsPreexisted = (await readdir(HOST_SKILLS).catch(() => undefined)) !== undefined;
	const work = await mkdtemp(join(tmpdir(), "pi-ez-handoff-test-"));
	const project = join(work, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "main.go"), "package main\n", "utf8");
	await writeFile(join(project, "go.mod"), "module x\n", "utf8");
	await mkdir(join(project, ".git"), { recursive: true });
	await writeFile(join(project, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");

	let createdSkills = false;
	if (!hostSkillsPreexisted) {
		await mkdir(HOST_SKILLS, { recursive: true });
		await writeFile(join(HOST_SKILLS, "t.md"), "---\nname: t\n---\n", "utf8");
		createdSkills = true;
	}

	try {
		await mkdir(CHAT_HOME, { recursive: true });
		await writeFile(
			CHAT_CONFIG_PATH,
			JSON.stringify({ accounts: { [TEST_ACCOUNT]: { name: "A", service: "discord", channels: { [TEST_CHANNEL]: { name: "c" } } } } }),
			"utf8",
		);

		const config = await loadChatConfig();
		const channel = resolveChannelById(config, CONV_ID);
		check("channel resolved", !!channel);
		if (!channel) throw new Error("setup");

		await rm(channel.workspaceDir, { recursive: true, force: true });
		await rm(channel.sharedDir, { recursive: true, force: true });

		// Basic mount
		const r1 = await mountIntoChannel({ channel, projectDir: project });
		check("workspace files copied", r1.projectFileCount >= 3);
		check("skills copied", r1.skillsCount >= 1);
		const ws = await readdir(channel.workspaceDir);
		check("workspace has main.go", ws.includes("main.go"));
		check("workspace has .git", ws.includes(".git"));
		const sharedSkills = await readdir(join(channel.sharedDir, "skills"));
		check("shared/skills/ populated", sharedSkills.length > 0);

		// Non-empty workspace without --force refuses
		try {
			await mountIntoChannel({ channel, projectDir: project });
			check("refuses on non-empty without --force", false);
		} catch (err) {
			check("refuses on non-empty without --force", String((err as Error).message).includes("non-empty"));
		}

		// --force replaces
		await writeFile(join(channel.workspaceDir, "stale.txt"), "old\n", "utf8");
		const r2 = await mountIntoChannel({ channel, projectDir: project, force: true });
		const wsAfter = await readdir(channel.workspaceDir);
		check("--force removes stale files", !wsAfter.includes("stale.txt"));
		check("--force re-copies project", wsAfter.includes("main.go"));

		// --force preserves pi-chat workspace artifacts
		await writeFile(join(channel.workspaceDir, "memory.md"), "remembered\n", "utf8");
		await mountIntoChannel({ channel, projectDir: project, force: true });
		const memContent = await readFile(join(channel.workspaceDir, "memory.md"), "utf8");
		check("--force preserves memory.md", memContent === "remembered\n");

		// --no-skills
		await rm(channel.workspaceDir, { recursive: true, force: true });
		await rm(channel.sharedDir, { recursive: true, force: true });
		const r3 = await mountIntoChannel({ channel, projectDir: project, mountSkills: false });
		check("--no-skills: skillsCount = 0", r3.skillsCount === 0);
		const sharedAfter = await readdir(join(channel.sharedDir, "skills")).catch(() => []);
		check("--no-skills: shared/skills not created", sharedAfter.length === 0);

		// Bad project dir
		try {
			await mountIntoChannel({ channel, projectDir: "/no/such/dir/anywhere" });
			check("rejects missing project", false);
		} catch (err) {
			check("rejects missing project", String((err as Error).message).includes("not a directory"));
		}

		// === BACKGROUND MODE: session injection ===
		// Synthesize a host session file. Must include an assistant message because
		// SessionManager._persist gates writes on hasAssistant — entries appended
		// before any assistant turn buffer in memory and don't reach disk.
		const fakeSession = join(work, "fake-session.jsonl");
		const header = { type: "session", version: 3, id: "host-sess-1", timestamp: "2025-01-01T00:00:00.000Z", cwd: project };
		const userMsg = {
			type: "message", id: "m1", parentId: null, timestamp: "2025-01-01T00:01:00.000Z",
			message: { role: "user", content: "earlier work" },
		};
		const asstMsg = {
			type: "message", id: "m2", parentId: "m1", timestamp: "2025-01-01T00:01:05.000Z",
			message: { role: "assistant", content: [{ type: "text", text: "doing the work" }] },
		};
		await writeFile(fakeSession, [header, userMsg, asstMsg].map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");

		await rm(channel.sessionDir, { recursive: true, force: true });
		await rm(channel.workspaceDir, { recursive: true, force: true });

		const rBg = await mountIntoChannel({
			channel,
			projectDir: project,
			sessionFile: fakeSession,
			hostCwd: project,
		});
		check("--background: returns injected session file", !!rBg.injectedSessionFile);
		check("--background: session in tmux-sessions dir",
			rBg.injectedSessionFile?.startsWith(channel.sessionDir) ?? false,
			`got: ${rBg.injectedSessionFile}`);

		const injected = await readFile(rBg.injectedSessionFile!, "utf8");
		const injLines = injected.trim().split("\n").map((l) => JSON.parse(l));
		check("--background: contains original message", injLines.some((l) => l.id === "m1"));
		check("--background: has new session id (fork)",
			injLines[0].id !== "host-sess-1" && injLines[0].type === "session");
		check("--background: parentSession points to host", injLines[0].parentSession === fakeSession);
		check("--background: header cwd = project", injLines[0].cwd === project);
		const stateEntries = injLines.filter((l) => l.type === "custom" && l.customType === "pi-chat-state");
		check("--background: pi-chat-state binding entry present", stateEntries.length === 1);
		check("--background: binding entry has correct conversationId",
			stateEntries[0]?.data?.conversationId === CONV_ID);

		// continueRecent picks the most-recent file — verify by reading what's there
		const sessionDirEntries = await readdir(channel.sessionDir);
		const jsonlFiles = sessionDirEntries.filter((n) => n.endsWith(".jsonl"));
		check("--background: tmux-sessions dir has exactly one .jsonl", jsonlFiles.length === 1);

		// Bad session file
		try {
			await mountIntoChannel({
				channel,
				projectDir: project,
				sessionFile: "/no/such/session.jsonl",
				force: true,
			});
			check("--background: rejects missing session file", false);
		} catch (err) {
			check("--background: rejects missing session file",
				String((err as Error).message).includes("not a regular file"));
		}

	} finally {
		await rm(work, { recursive: true, force: true });
		await rm(join(CHAT_HOME, "accounts", TEST_ACCOUNT), { recursive: true, force: true });
		await rm(join(CHAT_HOME, "tmux-sessions"), { recursive: true, force: true });
		if (configBackup === undefined) await rm(CHAT_CONFIG_PATH, { force: true });
		else await writeFile(CHAT_CONFIG_PATH, configBackup, "utf8");
		if (createdSkills) await rm(HOST_SKILLS, { recursive: true, force: true });
	}

	const passed = results.filter((r) => r.ok).length;
	const failed = results.length - passed;
	for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.details ? `   [${r.details}]` : ""}`);
	console.log(`\n${passed}/${results.length} passed`);
	process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error("test crashed:", err); process.exit(2); });
