import { readlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "openrouter-key";
const BADGES: Record<string, string> = {
	work: ">> work 🦜",
	personal: ">> personal 🦆",
};

// pi resolves the `!cat` command once per process and caches it, so the badge is
// read once per session too: a mid-session `pi-key` switch must not flip the
// label until the next launch changes the key along with it.
function activeAccount(): string | undefined {
	try {
		const link = join(homedir(), ".pi", "agent", "openrouter", "active.key");
		return basename(readlinkSync(link));
	} catch {
		return undefined;
	}
}

function render(ctx: ExtensionContext, account: string | undefined): void {
	if (ctx.model?.provider !== "openrouter" || !account) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	ctx.ui.setStatus(STATUS_KEY, BADGES[account] ?? account);
}

export default function (pi: ExtensionAPI): void {
	let account: string | undefined;

	pi.on("session_start", (_event, ctx) => {
		account = activeAccount();
		render(ctx, account);
	});

	pi.on("model_select", (_event, ctx) => render(ctx, account));
}
