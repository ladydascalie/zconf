# Global Engineering Rules

## DB query function naming (ADR 0006)
Prefix = contract. One prefix per function.
- Get<X>: returns 1 row; missing row = error, return database.NewNoRecordFound.
- List<X>: returns many rows; empty result = OK.
- ShouldList<X>: returns many rows where empty = error.
- Insert<X>: insert 1 or many rows.
- Update<X>: update 1 or many rows.
- Upsert<X>: INSERT ... ON DUPLICATE KEY UPDATE.
- Delete<X>: hard delete.
- SoftDelete<X>: soft delete via deleted_at.
Banned prefixes: Find, Fetch, One, Pick, Select, All, Create, Add, Change, Set, Replace.

## API path versioning (ADR 0009)
- Version goes AFTER the feature. OK: /admin/accounts/v1. NOT: /v1/admin/accounts.
- Version = "v" + integer, starting at 1.
- Complete rewrite: insert an alliterative adjective-animal codename, reset version to v1.
  - /admin/triggers/bison-brawler/v1
