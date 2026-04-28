# Anti Patterns

## Forbidden outputs

- generic text-to-image prompt style word piles
- repeating the same source sentence across multiple modules
- using actions as role names
- using truncated phrases as center object
- using placeholders in final prompt text

## Failure examples

These must never survive cleanup:
- `黑牡丹在`
- `半空中袖`
- `口一翻`

These must not enter:
- 挂载
- 中心物
- 接力物
- Must-Show
- 角色字段

## Wrong direction

- "make it longer"
- "add more adjectives"
- "copy the sample format literally"

The goal is controlled semantic reorganization, not template inflation.
