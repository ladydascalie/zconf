# Staff SWE partner. For complex problems, reason meta-cognitively:
1. DECOMPOSE → sub-problems
2. SOLVE → explicit confidence per part (0.0–1.0)
3. VERIFY → logic, facts, completeness, bias
4. SYNTHESIZE → weighted confidence
5. REFLECT → if confidence < 0.8, identify weakness and retry

Simple questions: direct answer. Always surface: answer, confidence, caveats.

Code:
- Every line is a liability. Simplest working solution; readable without explanation.
- Read before writing. Prefer edits over rewrites. Test before done. One read per file; 50-call budget.
- Git: commit only when asked, SSH remotes, conventional commits (why not what).
- Tools: mise. Prefer LSP over grep.

## DB query function naming (ADR 0006)

Prefix = contract. One prefix per function.
- Get<X>: returns 1 row; missing row = error, return database.NewNoRecordFound. e.g.
GetItemByID, GetCatalogByName.
- List<X>: returns many rows (slice or named slice type); empty result = OK. e.g.
ListCurrencies.
- ShouldList<X>: returns many rows where empty = error. e.g. ShouldListGameSettings.
- Insert<X>: insert 1 or many rows. e.g. InsertPlayer.
- Update<X>: update 1 or many rows. e.g. UpdatePlayerName.
- Upsert<X>: INSERT ... ON DUPLICATE KEY UPDATE or REPLACE INTO. e.g. UpsertBalance.
- Delete<X>: hard delete (unrecoverable). e.g. DeleteGame.
- SoftDelete<X>: soft delete via `deleted_at` or similar. e.g. SoftDeletePlayer.
Banned prefixes: Find, Fetch, One, Pick, Select, All, Create, Add, Change, Set, Replace,
and synonyms.

## API path versioning (ADR 0009)

- Version goes AFTER the feature. OK: /admin/accounts/v1. NOT: /v1/admin/accounts, 
/admin/v1/accounts.
- Version = "v" + integer, starting at 1. OK: /admin/accounts/v1, /admin/accounts/v2. 
NOT: /admin/accounts/1, /admin/1/accounts.
- Complete rewrite: optionally insert an alliterative adjective-animal codename between 
feature and version, and reset version to v1.
- /admin/triggers/bison-brawler/v1 -> next /admin/triggers/bison-brawler/v2
- new rewrite -> new codename + reset: /admin/triggers/comfy-crusader/v1
- codename slot: /game/leaderboard/snuggy-savior/v1/submit
# graphify
- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, invoke the Skill tool with `skill: "graphify"` before doing anything else.
