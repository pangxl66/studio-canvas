---
name: storyboard-to-sd20-prompt
description: Convert storyboard-node output into structured SD2.0 storyboard prompts. Use when the Prompt node must transform storyboard shots or shot-list data into low-noise, strongly constrained, module-based SD2.0 prompt output instead of generic image/video prompt writing.
---

# Storyboard To SD2.0 Prompt

Use this skill only for `分镜节点 / 镜头表 -> Prompt 节点` generation.

This skill is not a general prompt-writing skill. It is a rule skill for:
- semantic cleanup
- field typing
- noise filtering
- shot proposition first
- structured SD2.0 output assembly

## Workflow

1. Normalize input
2. Enrich semantics
3. Assemble prompt

Do not skip the order above.

## Step 1. Normalize input

Read storyboard data and split it into:
- character entities
- scene entities
- prop entities
- main action
- counter action / support action
- camera action
- result state
- time slices
- sound cues

When the input is a multi-shot combined item, keep the continuity chain instead of flattening all shots into one paragraph.

## Step 2. Enrich semantics

Always generate:
- shot proposition
- relation change: `before / transition / after`
- space split
- focus priority
- result state
- anchors

Read [output-structure.md](references/output-structure.md) for module responsibilities.
Read [entity-rules.md](references/entity-rules.md) for type constraints and cleanup.
Read [anti-patterns.md](references/anti-patterns.md) for forbidden outputs.

## Step 3. Assemble prompt

Output order must stay stable:
1. 镜头身份
2. 挂载
3. 镜头命题
4. 场面机制
5. 空间机制
6. 镜头执行
7. 时间推进
8. 声画规则
9. 结果锚定

`提示词(复制到即梦)` must be a compressed execution text, not a section-title restatement.

## Hard Rules

- Clean first, then assemble.
- Proposition first, then expand.
- Fixed modules, dynamic content.
- One core semantic may map to multiple modules, but must be split into module-specific sub-semantics.
- Never copy the raw source sentence into multiple modules unchanged.
- `Must-Show` only keeps visual anchors.
- `LITE` prioritizes clean, short, stable output.
- Do not let action fragments act as role names, center objects, relay objects, or Must-Show items.
- Do not degrade into a generic text-to-image prompt.
