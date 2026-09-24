// Shared types for fleet-web. Lenient by design: pi-subagents docs mandate
// ignoring unknown fields and event types for forward compatibility.

export interface Usage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	reasoning?: number;
	total?: number; // status.json totalTokens projection
	totalTokens?: number; // message-level events use this name
	window?: number;
	windowPeak?: number;
}

export interface Cost {
	inputTokens?: number;
	outputTokens?: number;
	costUsd?: number;
}

export interface StepInfo {
	agent?: string;
	status?: string;
	runId?: string;
	workflowKey?: string;
	label?: string;
	sessionFile?: string;
	sessionName?: string;
	transcriptPath?: string;
	durationMs?: number;
	startedAt?: number;
	endedAt?: number;
	model?: string;
	tokens?: Usage;
	totalCost?: Cost;
	toolCount?: number;
	turnCount?: number;
	contextLimit?: number;
	thinking?: string;
	context?: string;
	recentTools?: Array<{ tool?: string; args?: string; endMs?: number }>;
	recentOutput?: Array<unknown>;
	[key: string]: unknown;
}

export interface ProcessTerminal {
	state?: string;
	observedAt?: number;
	resumeDisposition?: string;
	instances?: Array<{ kind?: string; exitCode?: number | null; signal?: string | null }>;
	[key: string]: unknown;
}

export interface StatusDoc {
	lifecycleArtifactVersion?: number;
	runId?: string;
	id?: string;
	sessionId?: string;
	sessionDir?: string;
	sessionFile?: string;
	cwd?: string;
	mode?: string;
	state?: string;
	startedAt?: number;
	endedAt?: number;
	lastUpdate?: number;
	lastActivityAt?: number;
	durationMs?: number;
	deadlineAt?: number;
	timeoutMs?: number;
	pid?: number;
	outputFile?: string;
	outputs?: unknown;
	artifactsDir?: string;
	workflowKey?: string;
	parentWorkflowRunId?: string;
	parallelGroups?: unknown;
	chainStepCount?: number;
	currentStep?: number;
	steps?: StepInfo[];
	totalTokens?: Usage;
	totalCost?: Cost;
	toolCount?: number;
	turnCount?: number;
	steering?: Record<string, unknown>;
	processTerminal?: ProcessTerminal;
	runFanoutBudget?: Record<string, unknown>;
	launchResolvedExtensions?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface WorkflowReceiptEntry {
	key?: string;
	agent?: string;
	resolvedContext?: string;
	outputReference?: string;
	continuation?: { runIds?: string[] };
	latestRunId?: string;
	resumability?: { state?: string };
	[key: string]: unknown;
}

export interface WorkflowReceipt {
	version?: number;
	workflowRunId?: string;
	state?: string;
	createdAt?: number;
	entries?: Record<string, WorkflowReceiptEntry>;
	workflowChildren?: {
		children?: Array<{
			childId?: string;
			runId?: string;
			agent?: string;
			sessionName?: string;
			model?: string;
			[key: string]: unknown;
		}>;
	};
	[key: string]: unknown;
}

// ---- events.jsonl ----

export interface ContentBlock {
	type: string; // text | thinking | toolCall | ...
	text?: string;
	id?: string;
	name?: string;
	arguments?: unknown;
	thinking?: string;
	[key: string]: unknown;
}

export interface ParsedMessage {
	role: string;
	blocks: ContentBlock[];
	model?: string;
	provider?: string;
	usage?: Usage;
	cost?: Cost;
	stopReason?: string;
	timestamp?: number;
}

export interface ToolExecution {
	toolCallId: string;
	toolName?: string;
	args?: unknown;
	result?: unknown;
	isError?: boolean;
	/** ok = executed, error = executed and failed, aborted = issued but never executed */
	state?: "ok" | "error" | "aborted";
	startedAt?: number;
	endedAt?: number;
}

export interface ChildTranscript {
	childRunId: string;
	agent?: string;
	stepIndex: number;
	messages: ParsedMessage[];
	toolExecutions: ToolExecution[];
	totalUsage: Usage;
	startedAt?: number;
	endedAt?: number;
	eventCount: number;
	firstUserMessage?: string;
}

export interface EventsFileMeta {
	path: string;
	bytes: number;
	lineCount: number;
}
