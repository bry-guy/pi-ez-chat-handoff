# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-22

### Added
- Initial `pi-ez-chat-handoff` release as a shareable pi extension package.
- `/chat-ez-handoff` command for mounting a project into a configured pi-chat channel workspace.
- Optional skill copying from `~/.pi/agent/skills` into the account shared skills directory.
- Foreground handoff flow that pairs with pi-chat's `/chat-connect`.
- Background handoff flow that forks the current session for pi-chat `/chat-spawn-all` workers.
- Safety checks for non-empty workspaces, with `--force` preserving pi-chat workspace artifacts.
- Type-check, test, package validation, and release-please GitHub release workflow.
