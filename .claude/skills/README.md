# Claude Code Skills

This directory contains project-specific skills that provide Claude with domain knowledge and best practices for this codebase.

## Skills by Category

### Code Quality & Patterns
| Skill | Description |
|-------|-------------|
| [systematic-debugging](./systematic-debugging/SKILL.md) | Four-phase debugging methodology, root cause analysis |

### React & UI
| Skill | Description |
|-------|-------------|
| [react-ui-patterns](./react-ui-patterns/SKILL.md) | React patterns, loading states, error handling |

> 以前ここにあった `formik-patterns` / `graphql-schema` / `core-components` / `testing-patterns` は
> 他プロジェクトのテンプレートの取り違えで、このアプリのスタック（Next.js App Router / Supabase /
> Tailwind / vitest）と無関係だったため削除した（2026-07）。実際の規約は `.claude/rules/*.md`
> （design.md / features.md / security.md / stack.md / structure.md / tax.md）と `CLAUDE.md` を参照。
> テストは Jest ではなく **vitest**（`vitest.config.ts`）。既存の `**/*.test.ts` を手本にする。

## How Skills Work

Skills are automatically invoked when Claude recognizes relevant context. Each skill provides:

- **When to Use** - Trigger conditions
- **Core Patterns** - Best practices and examples
- **Anti-Patterns** - What to avoid
- **Integration** - How skills connect

## Adding New Skills

1. Create directory: `.claude/skills/skill-name/`
2. Add `SKILL.md` (case-sensitive) with YAML frontmatter:
   ```yaml
   ---
   # Required fields
   name: skill-name              # Lowercase, hyphens, max 64 chars
   description: What it does and when to use it. Include trigger keywords.  # Max 1024 chars

   # Optional fields
   allowed-tools: Read, Grep, Glob    # Restrict available tools
   model: claude-sonnet-4-20250514    # Specific model to use
   ---
   ```
3. Include standard sections: When to Use, Core Patterns, Anti-Patterns, Integration
4. Add to this README
5. Add triggers to `.claude/hooks/skill-rules.json`

**Important:** The `description` field is critical—Claude uses semantic matching on it to decide when to apply the skill. Include keywords users would naturally mention.

## Maintenance

- Update skills when patterns change
- Remove outdated information
- Add new patterns as they emerge
- Keep examples current with codebase
