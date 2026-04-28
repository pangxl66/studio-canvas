# Entity Rules

## Field typing

### 角色挂载
Allowed:
- role names
- clearly visible/offscreen character entities

Forbidden:
- action fragments
- incomplete phrases
- placeholders

### 场景挂载
Allowed:
- scene names
- space labels
- split spaces

Forbidden:
- action verbs
- dialogue fragments

### 中心物 / 接力物 / Must-Show / 焦点对象
Allowed:
- visible props
- visible spatial objects
- stable result anchors
- key visual states

Forbidden:
- sentence fragments
- incomplete action-object pieces
- placeholders
- asset labels

## Noise filtering

Filter or repair:
- truncated phrases
- broken verb-object fragments
- tokens like `黑牡丹在`
- tokens like `半空中袖`
- tokens like `口一翻`
- `文字生成版` / `无素材` / asset placeholder text

## Normalization rules

- strip directional prefixes/suffixes when they pollute role names
- strip result wrappers such as `落幅定在`, `结果位`, `停在`
- reduce long source phrases into stable visual anchors before they enter structured fields
