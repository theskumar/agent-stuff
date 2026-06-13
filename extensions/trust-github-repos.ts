/**
 * Trust GitHub Repos Extension
 *
 * What it is:
 *   Hooks pi's `project_trust` event and auto-grants trust when the current
 *   working directory is inside a git checkout whose `origin` remote points
 *   at a trusted GitHub owner (currently `fueled`, `theskumar`,
 *   `earendil-works`). The grant is persisted so future sessions in the same
 *   directory skip the prompt entirely.
 *
 *   Project-local resources (extensions, skills, prompts, AGENTS.md) only
 *   load after trust is granted, so this fires *before* those resources are
 *   resolved — they become available automatically.
 *
 *   Source: adapted from mitsuhiko/agent-stuff. The trusted-owners allowlist
 *   is the customization.
 *
 * Use cases:
 *   - You routinely work in your own / your org's repos and don't want a
 *     trust prompt every time you `cd` into a new clone.
 *   - Project-local pi extensions / skills / AGENTS.md should "just work"
 *     for known-good owners.
 *   - Pair with worktree-heavy workflows (sub-projects, forks) where the
 *     prompt is purely friction.
 *
 * Common usage patterns:
 *   - Install once; no command surface.
 *   - To trust more owners, edit `TRUSTED_GITHUB_OWNERS` in this file and
 *     re-link via `install.sh`.
 *   - Repos outside the allowlist still go through the normal trust prompt.
 */

import type { ExtensionAPI, ProjectTrustEventResult } from "@earendil-works/pi-coding-agent";

const TRUSTED_GITHUB_OWNERS = new Set(["fueled", "theskumar", "earendil-works"]);
const GIT_TIMEOUT_MS = 5_000;

type GitHubRepo = {
	owner: string;
	repo: string;
};

function trimGitSuffix(repo: string): string {
	return repo.replace(/\.git$/i, "");
}

function parseGitHubRemoteUrl(remoteUrl: string): GitHubRepo | null {
	const value = remoteUrl.trim();
	if (!value) {
		return null;
	}

	// SCP-like SSH syntax: git@github.com:owner/repo.git
	const scpMatch = value.match(/^(?:[^@/:\s]+@)?github\.com:([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
	if (scpMatch) {
		return {
			owner: scpMatch[1],
			repo: trimGitSuffix(scpMatch[2]),
		};
	}

	try {
		const parsed = new URL(value);
		if (parsed.hostname.toLowerCase() !== "github.com") {
			return null;
		}

		const parts = parsed.pathname
			.replace(/^\/+|\/+$/g, "")
			.split("/")
			.filter(Boolean);

		if (parts.length !== 2) {
			return null;
		}

		return {
			owner: decodeURIComponent(parts[0]),
			repo: trimGitSuffix(decodeURIComponent(parts[1])),
		};
	} catch {
		return null;
	}
}

function isTrustedGitHubRemote(remoteUrl: string): boolean {
	const repo = parseGitHubRemoteUrl(remoteUrl);
	return !!repo && TRUSTED_GITHUB_OWNERS.has(repo.owner.toLowerCase());
}

async function getOriginRemoteUrls(pi: ExtensionAPI, cwd: string): Promise<string[]> {
	try {
		const result = await pi.exec("git", ["remote", "get-url", "--all", "origin"], {
			cwd,
			timeout: GIT_TIMEOUT_MS,
		});

		if (result.code !== 0) {
			return [];
		}

		return result.stdout
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

export default function trustGitHubReposExtension(pi: ExtensionAPI): void {
	pi.on("project_trust", async (event): Promise<ProjectTrustEventResult> => {
		const originUrls = await getOriginRemoteUrls(pi, event.cwd);
		if (originUrls.length > 0 && originUrls.every(isTrustedGitHubRemote)) {
			return { trusted: "yes", remember: true };
		}

		return { trusted: "undecided" };
	});
}
