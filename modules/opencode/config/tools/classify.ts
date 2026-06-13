import { tool } from "@opencode-ai/plugin";

export default tool({
  description: "Classify a user request to determine which subagent type should handle it. Returns structured JSON with action, subagent_type, reasoning, and confidence.",
  args: {
    request: tool.schema.string().describe("The full user request to classify — include all context"),
  },
  async execute(args) {
    const r = args.request.trim();
    if (r.length === 0) {
      return JSON.stringify({ action: "handle_directly", reasoning: "Empty request", confidence: 1.0 });
    }
    const lower = r.toLowerCase();
    const wordCount = lower.split(/\s+/).length;
    if (wordCount <= 2) {
      return JSON.stringify({ action: "handle_directly", reasoning: "Very short request", confidence: 0.95 });
    }

    // 1. Debugging / investigation
    if (/(?:debug|investigate|troubleshoot|diagnose|root cause)\b/.test(lower) || /\bwhy\s+(?:is|did|does|are|was|were|can't|wont|isnt|arent)\b/.test(lower)) {
      return JSON.stringify({ action: "delegate", subagent_type: "build", reasoning: "Investigation needed", confidence: 0.85 });
    }

    // 2. File discovery
    if (/(?:find|locate|where (?:is|are|can I find|do I find)|search.*(?:file|code)|discover|which (?:file|class|function|service|route|endpoint)|what (?:file|class|function|route|endpoint|service)|navigate to|go to (?:the )?(?:file|definition)|look up)\b/.test(lower) && /(?:file|class|function|symbol|route|endpoint|code|source|definition|handler|service|method|variable|type)\b/.test(lower)) {
      return JSON.stringify({ action: "delegate", subagent_type: "explore", reasoning: "File discovery needed", confidence: 0.9 });
    }

    // 3. Large implementation (standalone keywords — no wordCount gate)
    if (/(?:feature|implement|migrate|rewrite|restructure|scaffold|generat(?:e|or)|comprehensive|full (?:rewrite|overhaul|redesign|implementation))\b/.test(lower)) {
      return JSON.stringify({ action: "delegate", subagent_type: "build", reasoning: "Multi-file change or new feature", confidence: 0.85 });
    }

    // 4. Small isolated changes
    if (wordCount < 50 && /(?:fix|bug|typo|rename|delete|remove|update|bump|change|correct|adjust|patch|hotfix|resolve|clean ?up|tweak|tidy|sort out|workaround|insert|revert|add|create)\b/.test(lower)) {
      return JSON.stringify({ action: "delegate", subagent_type: "task", reasoning: "Small isolated change", confidence: 0.9 });
    }

    // 5. Planning & architecture
    if (/(?:plan|architecture|design|strategy|approach|roadmap|milestone|blueprint|migration|trade[ -]?off|decompos(?:e|ing)|proposal|architect)\b/.test(lower) || /(?:how should|what should).{0,80}(?:structure|organize|organise|organization|design|architect|approach|plan|setup|scaffold)\b/.test(lower) || (/\brefactor\b/.test(lower) && /(?:plan|approach|strategy|steps|outline)\b/.test(lower))) {
      return JSON.stringify({ action: "delegate", subagent_type: "plan", reasoning: "Planning or architecture needed", confidence: 0.9 });
    }

    // 6. Large implementation (wordCount-gated — for add/create/build/write/setup that aren't standalone build keywords)
    if ((wordCount > 30 && /(?:add|create|build|write|setup)\b/.test(lower)) || (/\brefactor\b/.test(lower) && wordCount > 20)) {
      return JSON.stringify({ action: "delegate", subagent_type: "build", reasoning: "Multi-file change or new feature", confidence: 0.85 });
    }

    return JSON.stringify({ action: "handle_directly", reasoning: "Q&A or ambiguous request", confidence: 0.8 });
  },
});
