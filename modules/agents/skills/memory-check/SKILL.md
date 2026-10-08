---
name: memory-check
description: Read-only hygiene checks over the shared memory store and the spec library — core size, dead manifest pointers, uncommitted stores, stale tasks files, stale anchors. Use after a merge or a batch of memory writes lands, when the injected core has grown, or when asked to check memory / run /memory-check.
---

# Memory check

Deterministic, local, read-only: no network, no model call. **Silent when clean** — report only what needs
acting on, one line per finding, and never block anything. A check that fails to run is reported too, so
the checker cannot rot into a silent no-op.

Store root: `~/.agents/store/` (one store, shared by every harness; facts in `memory/`, spec
library in `plans/`). The injected core is each harness's own `AGENTS.md` —
`~/.config/delta/AGENTS.md` and `~/.pi/agent/AGENTS.md` — so the check walks whichever exist.

Run the whole block in one bash call:

```sh
store="$HOME/.agents/store/memory"; root="$HOME/.agents/store"; plans="$HOME/.agents/store/plans"

# 1 + 2. Each harness's injected core: within budget, and every pointer resolves
for core in "$HOME/.config/delta/AGENTS.md" "$HOME/.pi/agent/AGENTS.md"; do
  [ -f "$core" ] || continue

  size=$(wc -c < "$core")
  [ "$size" -le 10240 ] || echo "CORE: $core is $((size / 1024)) KB, over the ~10 KB budget — move a whole section to REFERENCE.md and leave one pointer line."

  while IFS= read -r line; do
    case "$line" in *'§'*) ;; *) continue ;; esac
    file=$(printf '%s' "$line" | sed -n 's/.*`\([A-Za-z0-9._-]*\.md\)`.*/\1/p')
    [ -n "$file" ] || continue
    sec=$(printf '%s' "$line" | sed -n 's/.*§ *//; s/ *—.*$//; s/[.,;:]*$//; p')
    if [ ! -f "$store/$file" ]; then
      echo "POINTER: $core names $file, which does not exist in the store."
    elif [ -n "$sec" ] && ! grep -qxF "## $sec" "$store/$file"; then
      echo "POINTER: $core names $file § $sec — no such heading."
    fi
  done < "$core"
done

# 3. Spec-library README refs exist
grep -oE '^- (specs|changes)/[^ `.]+\.md' "$plans/README.md" 2>/dev/null | awk '{print $2}' | while IFS= read -r rel; do
  [ -f "$plans/$rel" ] || echo "SPECS: README points at $rel, which does not exist."
done

# 4. Store is git-clean
for d in "$root"; do
  out=$(git -C "$d" status --short 2>/dev/null) || { echo "GIT: $d is not a git repo (or git failed)."; continue; }
  [ -z "$out" ] || { echo "GIT: $d has uncommitted changes:"; printf '%s\n' "$out"; }
done

# 5. Stale closeout — a tasks file with no open tasks, >7 days untouched.
#    Tasks files live at changes/<project>/<topic>/tasks.md, so the scan is depth 3;
#    depth 4 is changes/archive/<project>/<topic>, which is reference, not a to-do.
find "$plans/changes" -mindepth 3 -maxdepth 3 -name 'tasks.md' -mtime +7 2>/dev/null | while IFS= read -r f; do
  if ! grep -q '\[ \]' "$f" && grep -qi '\[x\]' "$f"; then
    echo "CLOSEOUT: ${f##*/} has no open tasks and has not changed in over 7 days — verify whether it landed; if so close it out (promote the spec, delete the file, drop the README In flight line)."
  fi
done

# 6. Anchored facts still resolve (see memory-keeping § Anchors)
bash "$HOME/zconf/modules/memory/recall-verify.sh"
```

Then, if there was any finding: state what you did about it, or why you are leaving it as is.
If there was none: say nothing.
