export type AiFilmmakingPromptNodeKind =
  | 'film_character_node'
  | 'film_storyboard_node'
  | 'film_video_prompt_node';

export type AiFilmmakingVideoMode = 'A' | 'B' | 'C';

export type AiFilmmakingSourceSummary = {
  textBlocks: string[];
  characterPrompts: string[];
  storyboardPrompts: string[];
  imageLabels: string[];
  storyboardImageLabels: string[];
  characterImageLabels: string[];
};

export function stripAiFilmmakingPromptWrapper(raw: string): string {
  let text = raw.replace(/^\uFEFF/, '').trim();
  const fenced = text.match(/^```(?:text|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) text = fenced[1].trim();
  text = text.replace(/^提示词[:：]\s*/i, '').trim();
  text = text.replace(/^最终提示词[:：]\s*/i, '').trim();
  text = text.replace(/^结果[:：]\s*/i, '').trim();
  return text;
}

export function buildAiFilmmakingSystemPrompt(kind: AiFilmmakingPromptNodeKind): string {
  const base = [
    'You are an AI filmmaking prompt designer. Follow the provided ai-filmmaking SKILL.md rules exactly.',
    'Core rules: fill every placeholder; keep prompts lean, concrete, cinematic, and paste-ready; preserve character identity verbatim across downstream templates; keep style language consistent; do not use the project legacy PromptOutput JSON schema.',
    'Return only the final prompt text. No explanation, no analysis, no JSON, no extra notes.',
    'If source material is mainly Chinese, write the final prompt in Chinese. If source material is mainly English, write the final prompt in English.',
    'If you use a fenced code block, the code block must contain only the prompt text.',
    'Never leave bracketed placeholders like [CHARACTER DESCRIPTION] or [STYLE BLOCK]. Replace every bracket with concrete copy inferred from the input.',
  ];

  if (kind === 'film_character_node') {
    return [
      ...base,
      '',
      'Template 1: Character Sheet.',
      'Generate one image-model prompt for Nano Banana Pro / GPT Image 2 / Midjourney / Flux.',
      'If a reference image is attached, use Mode A: do not re-describe the character in prose; the image is the identity anchor. Ask for strong reference matching, 1:1 similarity, neutral studio lighting, simple background, 8-shot grid, 16:9.',
      'If no reference image is attached, use Mode B: write a tight 30-60 word character identity description, then the same 8-shot grid character sheet prompt.',
      'Keep lighting neutral. Always include: Background should be simple and not distracting from character design.',
    ].join('\n');
  }

  if (kind === 'film_storyboard_node') {
    return [
      ...base,
      '',
      'Template 2: Cinematic Storyboard Grid.',
      'Generate one prompt for a single 3x3 grid image containing 9 sequential storyboard panels for one continuous scene.',
      'Use short director-style beats, not prose. Each panel must advance action and vary framing.',
      'Each panel needs a thin annotation strip under it with three short uppercase lines: CAM, MOVE, and MOOD. Use VOICE instead of MOOD for vlog/dialogue-driven scenes, or STYLE instead of MOOD for action/martial-arts scenes.',
      'Character descriptions must be one tight sentence each. If input lacks specifics, infer conservative defaults from the scene.',
      'Default visual style: cinematic live-action, photorealistic, lifelike, 35mm film grain, 16:9 page layout, unless the input clearly asks otherwise.',
    ].join('\n');
  }

  return [
    ...base,
    '',
    'Template 3: Seedance 2.0 Video Prompts.',
    'Generate Seedance 2.0 prompt text using the detected variant:',
    'Variant A: text-driven shots, optional character sheet references.',
    'Variant B: storyboard grid as the main reference.',
    'Variant C: character sheets plus storyboard grid.',
    'Default duration is always 15 seconds unless the input explicitly asks for less. Cover the full 0:00-0:15 timeline.',
    'Default audio is NO MUSIC unless the user explicitly asks for music. Ambient sound and Foley are allowed.',
    'Use @image numbering correctly: every reference gets a unique number. Character sheet references come first, storyboard grid comes after character sheets.',
    'If using Variant B or C, say the storyboard grid should be read as sequential shots, not as one image.',
    'When the app-provided mode is uncertain, inspect the attached image and source text: use B for a visible 9-panel storyboard/grid, C for character reference plus storyboard grid, otherwise A.',
  ].join('\n');
}

function formatSourceSummary(summary: AiFilmmakingSourceSummary): string {
  const parts: string[] = [];
  if (summary.textBlocks.length > 0) {
    parts.push(`TEXT INPUT:\n${summary.textBlocks.join('\n\n---\n\n')}`);
  }
  if (summary.characterPrompts.length > 0) {
    parts.push(`CHARACTER PROMPTS / SHEETS:\n${summary.characterPrompts.join('\n\n---\n\n')}`);
  }
  if (summary.storyboardPrompts.length > 0) {
    parts.push(`STORYBOARD GRID PROMPTS:\n${summary.storyboardPrompts.join('\n\n---\n\n')}`);
  }
  if (summary.imageLabels.length > 0) {
    parts.push(
      `CONNECTED IMAGE REFERENCES:\n${summary.imageLabels
        .map((label, index) => `@image${index + 1}: ${label}`)
        .join('\n')}`,
    );
  }
  return parts.join('\n\n') || 'No upstream text was provided.';
}

export function buildCharacterSheetUserPrompt(summary: AiFilmmakingSourceSummary, hasReferenceImage: boolean): string {
  return [
    hasReferenceImage
      ? 'A reference image is attached. Generate Template 1 Mode A character sheet prompt. Do not re-describe the attached image; use it as the character identity anchor.'
      : 'No reference image is attached. Generate Template 1 Mode B character sheet prompt from the available text.',
    'The final prompt must be a single paste-ready image generation prompt. No commentary.',
    '',
    'SOURCE MATERIAL:',
    formatSourceSummary(summary),
  ].join('\n');
}

export function buildStoryboardGridUserPrompt(summary: AiFilmmakingSourceSummary): string {
  return [
    'Generate Template 2 Cinematic Storyboard Grid prompt from the source material.',
    'Output one complete prompt for a 3x3 / 9-panel continuous storyboard sheet.',
    'Fill all details concretely; no placeholders. Use concise beats and legible annotation strip instructions.',
    '',
    'SOURCE MATERIAL:',
    formatSourceSummary(summary),
  ].join('\n');
}

export function buildSeedanceVideoUserPrompt(
  summary: AiFilmmakingSourceSummary,
  mode: AiFilmmakingVideoMode,
): string {
  const variant =
    mode === 'C'
      ? 'Variant C - character sheets + storyboard grid.'
      : mode === 'B'
        ? 'Variant B - storyboard grid as the main reference.'
        : 'Variant A - text-driven shots, optional character sheet references.';
  return [
    `App-detected mode: ${variant}`,
    'Generate Template 3 Seedance 2.0 video prompt text for this mode. If the attached image clearly indicates another A/B/C variant, use the visually correct variant and name it in the prompt.',
    'Use 15 seconds by default. Use NO MUSIC unless source material explicitly requests music.',
    'Use correct @image numbering for every connected reference.',
    'Output only the final prompt text.',
    '',
    'SOURCE MATERIAL:',
    formatSourceSummary(summary),
  ].join('\n');
}
