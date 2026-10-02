/**
 * Thin wrapper over the herdr CLI.
 *
 * Every operation shells out to the `herdr` binary and parses its JSON
 * envelope (`{"id":…,"result":…}`). The runner is injectable so the pane-backed
 * manager can be exercised without a live herdr session.
 */

import { spawn } from "node:child_process";

export interface HerdrResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type HerdrRunner = (args: string[]) => Promise<HerdrResult>;

export interface HerdrWorkspace {
  workspaceId: string;
  tabId: string;
  label?: string;
}

export interface HerdrPane {
  paneId: string;
  workspaceId: string;
  tabId: string;
  cwd: string;
  label?: string;
}

export interface HerdrProcessInfo {
  shellPid?: number;
  foregroundPgid?: number;
}

export interface HerdrMetadata {
  source: string;
  tokens?: Record<string, string>;
  stateLabel?: string;
}

export interface Herdr {
  listWorkspaces(): Promise<HerdrWorkspace[]>;
  createWorkspace(label: string, cwd: string): Promise<{ workspaceId: string; tabId: string; rootPaneId: string }>;
  listPanes(workspaceId: string): Promise<HerdrPane[]>;
  paneTokens(paneId: string): Promise<Record<string, string>>;
  splitPane(paneId: string, cwd: string, direction?: "right" | "down"): Promise<string>;
  createTab(workspaceId: string, cwd: string): Promise<{ paneId: string; tabId: string }>;
  renamePane(paneId: string, label: string): Promise<void>;
  run(paneId: string, cmd: string): Promise<void>;
  read(paneId: string, lines: number): Promise<string>;
  processInfo(paneId: string): Promise<HerdrProcessInfo>;
  sendCtrlC(paneId: string): Promise<void>;
  closePane(paneId: string): Promise<void>;
  reportMetadata(paneId: string, metadata: HerdrMetadata): Promise<void>;
  focusPane(workspaceId: string, tabId: string): Promise<void>;
}

export class HerdrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HerdrError";
  }
}

/** True when this process is running inside a herdr-managed pane. */
export function herdrAvailable(): boolean {
  return process.env.HERDR_ENV === "1";
}

const defaultRunner: HerdrRunner = (args) =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (result: HerdrResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const child = spawn("herdr", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.on("data", (chunk: string) => (stderr += chunk));
    child.once("error", (err) => finish({ code: 127, stdout, stderr: err.message }));
    child.once("close", (code) => finish({ code: code ?? 1, stdout, stderr }));
  });

/** Build a herdr client. Omit `runner` to shell out to the real binary. */
export function createHerdr(runner: HerdrRunner = defaultRunner): Herdr {
  async function call(args: string[]): Promise<Record<string, unknown>> {
    const { code, stdout, stderr } = await runner(args);
    if (code !== 0) {
      const detail = stderr.trim() || stdout.trim() || `exit ${code}`;
      throw new HerdrError(`herdr ${args.join(" ")}: ${detail}`);
    }
    let envelope: unknown;
    const trimmed = stdout.trim();
    if (trimmed.length === 0) return {};
    try {
      envelope = JSON.parse(trimmed);
    } catch {
      throw new HerdrError(`herdr ${args.join(" ")}: unparseable output`);
    }
    if (isObject(envelope) && isObject(envelope.result)) return envelope.result;
    if (isObject(envelope)) return envelope;
    throw new HerdrError(`herdr ${args.join(" ")}: unexpected output shape`);
  }

  return {
    async listWorkspaces() {
      const result = await call(["workspace", "list"]);
      return asArray(result.workspaces).map((workspace) => ({
        workspaceId: String(workspace.workspace_id),
        tabId: String(workspace.active_tab_id ?? ""),
        label: typeof workspace.label === "string" ? workspace.label : undefined,
      }));
    },

    async createWorkspace(label, cwd) {
      const result = await call(["workspace", "create", "--label", label, "--cwd", cwd, "--no-focus"]);
      return {
        workspaceId: String(anyObject(result.workspace).workspace_id),
        tabId: String(anyObject(result.tab).tab_id),
        rootPaneId: String(anyObject(result.root_pane).pane_id),
      };
    },

    async listPanes(workspaceId) {
      const result = await call(["pane", "list", "--workspace", workspaceId]);
      return asArray(result.panes).map((pane) => ({
        paneId: String(pane.pane_id),
        workspaceId: String(pane.workspace_id ?? workspaceId),
        tabId: String(pane.tab_id ?? ""),
        cwd: String(pane.cwd ?? ""),
        label: typeof pane.custom_label === "string" ? pane.custom_label : undefined,
      }));
    },

    async paneTokens(paneId) {
      const result = await call(["pane", "get", paneId]);
      const tokens = anyObject(result.pane).tokens;
      if (!isObject(tokens)) return {};
      return Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key, String(value)]));
    },

    async splitPane(paneId, cwd, direction = "down") {
      const result = await call(["pane", "split", "--pane", paneId, "--direction", direction, "--cwd", cwd, "--no-focus"]);
      return String(anyObject(result.pane).pane_id);
    },

    async createTab(workspaceId, cwd) {
      const result = await call(["tab", "create", "--workspace", workspaceId, "--cwd", cwd, "--no-focus"]);
      return { paneId: String(anyObject(result.root_pane).pane_id), tabId: String(anyObject(result.tab).tab_id) };
    },

    async renamePane(paneId, label) {
      await call(["pane", "rename", paneId, label]);
    },

    async run(paneId, cmd) {
      await call(["pane", "run", paneId, cmd]);
    },

    async read(paneId, lines) {
      // `pane read` emits plain text, not the usual JSON envelope, so it must
      // not go through `call`.
      const { code, stdout, stderr } = await runner([
        "pane",
        "read",
        paneId,
        "--source",
        "recent-unwrapped",
        "--lines",
        String(lines),
      ]);
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `exit ${code}`;
        throw new HerdrError(`herdr pane read ${paneId}: ${detail}`);
      }
      return stdout;
    },

    async processInfo(paneId) {
      const result = await call(["pane", "process-info", "--pane", paneId]);
      const info = anyObject(result.process_info);
      return {
        shellPid: typeof info.shell_pid === "number" ? info.shell_pid : undefined,
        foregroundPgid: typeof info.foreground_process_group_id === "number" ? info.foreground_process_group_id : undefined,
      };
    },

    async sendCtrlC(paneId) {
      await call(["pane", "send-keys", paneId, "ctrl+c"]);
    },

    async closePane(paneId) {
      await call(["pane", "close", paneId]);
    },

    async reportMetadata(paneId, metadata) {
      const args = ["pane", "report-metadata", paneId, "--source", metadata.source];
      for (const [name, value] of Object.entries(metadata.tokens ?? {})) args.push("--token", `${name}=${value}`);
      if (metadata.stateLabel) args.push("--state-label", metadata.stateLabel);
      await call(args);
    },

    async focusPane(workspaceId, tabId) {
      await call(["workspace", "focus", workspaceId]);
      await call(["tab", "focus", tabId]);
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function anyObject(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isObject) : [];
}
