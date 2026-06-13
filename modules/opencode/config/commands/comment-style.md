---
description: Comment Style Enforcing
agent: build
---
# Skill: Enforcing Clean Comments (Rob Pike Style)

## Meta
- **Name:** Enforcing Clean Comments (Rob Pike Style)
- **Description:** Identifies, prevents, and removes decorative "banner" or "divider" comments (e.g., `// ── active30dPct ───`) in mixed codebases (Go, JS, HTML, Templ) to align with minimalist, self-documenting code philosophies.

## Core Principle

> "A delicate matter, requiring taste and judgement. I tend to err on the side of eliminating comments, for several reasons. First, if the code is clear, and uses good type names and variable names, it should explain itself. Second, comments aren't checked by the compiler, so there is no guarantee they're right, especially after the code is modified. A misleading comment can be very confusing. Third, the issue of typography: comments clutter code."
> — **Rob Pike, *Notes on Programming in C***

In a mixed-language codebase (especially one heavily utilizing Go), comments should be clear, minimalist prose. Decorative box-drawing characters, ASCII art dividers, and visual banners violate this rule by adding typographic clutter, breaking documentation generation tool chains (like `godoc`), and rotting instantly when variables are refactored.

## How to Audit and Find Violations

Because this codebase spans Go, JavaScript, HTML, and Templ files, standard language-specific linters often miss these cross-cutting patterns. Use line-oriented search tools like `ripgrep` (`rg`) or `grep` to hunt them down.

### 1. Target Regex Pattern
To match double slashes followed by Unicode box-drawing dashes (`─`), an identifier/title, and trailing dashes, use:
```regex
// ── \w+ ──+

```

### 2. Finding Violations with Ripgrep

Run this command from your project root to audit the entire repository (respects `.gitignore` by default):

```bash
rg '// ── \w+ ──+'

```

### 3. Finding Violations with Standard Grep

If `ripgrep` is not installed, use standard `grep` with Extended Regular Expressions (`-E`) or Perl-compatible syntax (`-P`):

```bash
grep -rE '// ── [a-zA-Z0-9_]+ ──+' .

```

## Remediation Workflow

When the search tool highlights a banner comment violation, do not simply remove the character markings—apply Pike’s rule of **taste and judgment**:

1. **Delete the Clutter:** If the code below the banner is self-documenting, well-named, and cohesive, delete the banner line entirely.
2. **Refactor for Clarity:** If you felt a banner was necessary to separate logic, ask yourself: *Should this block be extracted into its own function, method, or distinct file?* Better naming and structural isolation trump comment sections.
3. **Convert to Prose:** If documentation is genuinely required (e.g., exported Go packages or complex business rules), replace the banner with a standard, clean comment block that reads like human prose:

```go
   // Good: Standard, readable comment blocks parsed seamlessly by godoc.
   // Active30dPct tracks user retention metrics across a rolling window.

```
