export type AiFilmmakingPromptNodeKind =
  | 'film_character_node'
  | 'film_storyboard_node'
  | 'film_video_prompt_node';

export type AiFilmmakingVideoMode = 'A' | 'B' | 'C';

export type AiFilmStoryboardSkillPrompt = {
  name: string;
  instruction: string;
};

export type AiFilmmakingSourceSummary = {
  textBlocks: string[];
  characterPrompts: string[];
  storyboardPrompts: string[];
  storyboardTables: string[];
  storyboardPanelCount?: number;
  imageLabels: string[];
  storyboardImageLabels: string[];
  characterImageLabels: string[];
};

function normalizedStoryboardPanelCount(panelCount?: number): number {
  return typeof panelCount === 'number' && Number.isFinite(panelCount) && panelCount > 0
    ? Math.max(1, Math.round(panelCount))
    : 9;
}

function storyboardGridLayoutHint(panelCount?: number): string {
  const count = normalizedStoryboardPanelCount(panelCount);
  if (count === 1) return 'single large storyboard panel';
  if (count === 2) return 'two-panel split sheet';
  if (count === 3) return 'three-panel horizontal storyboard strip';
  if (count === 4) return '2x2 four-panel storyboard grid';
  if (count === 5) return 'five-panel storyboard sheet, 3 panels on the top row and 2 wider panels on the bottom row';
  if (count === 6) return '3x2 six-panel storyboard grid';
  if (count === 7) return 'seven-panel storyboard sheet, 4 panels on the top row and 3 panels on the bottom row';
  if (count === 8) return '4x2 eight-panel storyboard grid';
  if (count === 9) return '3x3 nine-panel storyboard grid';
  return `${count}-panel storyboard sheet with balanced multi-row layout, no blank filler panels`;
}

export function stripAiFilmmakingPromptWrapper(raw: string): string {
  let text = raw.replace(/^\uFEFF/, '').trim();
  const fenced = text.match(/^```(?:text|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) text = fenced[1].trim();
  text = text.replace(/^提示词[:：]\s*/i, '').trim();
  text = text.replace(/^最终提示词[:：]\s*/i, '').trim();
  text = text.replace(/^结果[:：]\s*/i, '').trim();
  return text;
}

function buildCharacterSheetSystemPrompt(): string {
  return [
    'You are using the AI_CHARACTER_SHEET_GPT55_SKILL specification for a character-setting node.',
    'This node generates production-grade character-sheet prompts for image models such as Nano Banana Pro, GPT Image, Flux, and Midjourney.',
    'Goal: produce a clean reusable identity-locking prompt for AI filmmaking. Do not write a character biography or dramatic scene.',
    '',
    'Output contract for this app:',
    'Return only one final paste-ready prompt text. No explanation, no analysis, no JSON, no note, no checklist.',
    'If you use a fenced code block, it must contain only the final prompt text.',
    'Never leave bracketed placeholders. Replace every bracket with concrete text inferred conservatively from the input.',
    'If source material is mainly Chinese, write the final prompt in Chinese. If source material is mainly English, write it in English.',
    '',
    'Core priorities:',
    '1. identity consistency',
    '2. accurate facial structure',
    '3. stable hairstyle and headwear',
    '4. stable body proportions',
    '5. practical costume continuity',
    '6. neutral lighting',
    '7. simple background',
    '8. clean multi-angle layout',
    '',
    'Mode selection:',
    'Mode A - full reference image available: use when the attached image clearly shows enough face, hairstyle, costume, and body. Treat the uploaded image as the primary source of truth. Do not over-describe what the image already shows. State identity, face, hairstyle, costume, textures, and proportions must be preserved. Add only layout, lighting, background, consistency, and exclusion rules.',
    'Mode B - partial reference image available: use when the attached image shows face or upper body but not full costume, lower body, footwear, or back structure. Preserve visible face, apparent age, facial structure, expression, hairstyle, headwear, visible upper-body costume, material texture, and temperament exactly. Complete missing lower-body/back/footwear details conservatively with practical, low-risk design. Never invent ornate decorations, armor, glowing effects, elaborate accessories, or unrelated historical redesign unless clearly supported or requested.',
    'Mode C - description only: use when no reference image is attached. Create a compact identity anchor of about 30-80 Chinese characters or 30-60 English words containing only age range, body type, face impression, hair, key wardrobe, headwear, and one essential prop if needed. Avoid narrative prose and scene effects.',
    '',
    'Default 8-shot 16:9 layout:',
    'Generate a horizontal 16:9 professional character sheet divided into four columns and eight views.',
    'Top row: 1 full-body front view, 2 full-body side view, 3 full-body three-quarter view, 4 full-body back view.',
    'Bottom row: 1 front face close-up, 2 side profile close-up, 3 three-quarter face close-up, 4 back hairstyle/headwear/structural detail close-up.',
    'Top-row full-body views must show the complete figure from head to toe. No cropping at the head, knees, ankles, shoes, or hems.',
    'All views must depict the same person with the same face, hairstyle, apparent age, body proportions, costume construction, and accessories.',
    'Use neutral standing poses with relaxed hands. Do not use battle poses unless explicitly requested.',
    '',
    'Identity lock when an image is attached:',
    'Strictly reference the uploaded image. Preserve the same face and apparent age. Preserve facial proportions, eyebrow shape, eye expression, nose, mouth, jawline, hairstyle silhouette, hairline, headwear, and temperament. Maintain the highest possible similarity to the uploaded character. Do not change the actor or replace the face. Do not identify a real person by name. Do not beautify excessively, do not apply influencer-style makeup, and do not smooth skin into plastic texture.',
    '',
    'Conservative completion:',
    'When the reference image does not show full costume, explicitly say that missing areas are restrained completion, not redesign. Good completions include simple trousers, practical boots, understated waist sash, matching fabric and palette, restrained layering, and live-action feasibility. Avoid ornate armor without evidence, glowing fantasy effects, elaborate embroidery without evidence, giant shoulder pads, excessive accessories, random jewelry, genre drift, and unrelated costume redesign.',
    '',
    'Lighting and background:',
    'Default to neutral soft studio lighting, even facial illumination, realistic skin texture, practical costume-test photography, and no scene-specific light contamination.',
    'Avoid moonlight, firelight, neon light, colored rim light, fog beams, dramatic backlight, battle sparks, and rain unless explicitly requested.',
    'Background should be simple and not distracting from character design. Use low-saturation gray, dark gray, warm neutral gray, or clean studio backdrop. Avoid forest, rooftop, palace, city street, battlefield, complex architecture, and unrelated props.',
    '',
    'Visual style blocks. Choose the closest one and adapt it concretely:',
    'Live-action wuxia: 真人写实，东方古装武侠院线电影质感，真实皮肤纹理，真实布料质感，接近实拍定妆照，不要游戏建模感，不要 3D 渲染感。',
    'Republican-era spy thriller: 真人写实，民国谍战电影定妆照质感，克制低调，真实旧布料纹理，接近实拍服装测试照，不要时尚大片感。',
    'Historical realism: 真人写实，历史题材院线电影质感，服装结构实拍可行，材质自然，妆造克制，不做夸张幻想化处理。',
    'Modern realistic drama: 真人写实，影视定妆照质感，自然皮肤纹理，中性棚拍光，真实服装材质，不做商业广告式过度精修。',
    '',
    'Required negative constraints:',
    'Do not include complex environments, poster text, watermark, UI elements, game-model look, 3D render look, anime style, plastic skin, excessive retouching, or unsupported redesign.',
  ].join('\n');
}

export function buildAiFilmmakingSystemPrompt(
  kind: AiFilmmakingPromptNodeKind,
  storyboardSkill?: AiFilmStoryboardSkillPrompt,
  storyboardPanelCount?: number,
): string {
  if (kind === 'film_character_node') return buildCharacterSheetSystemPrompt();

  const base = [
    'You are an AI filmmaking prompt designer. Follow the provided ai-filmmaking SKILL.md rules exactly.',
    'Core rules: fill every placeholder; keep prompts lean, concrete, cinematic, and paste-ready; preserve character identity verbatim across downstream templates; keep style language consistent; do not use the project legacy PromptOutput JSON schema.',
    'Return only the final prompt text. No explanation, no analysis, no JSON, no extra notes.',
    'If source material is mainly Chinese, write the final prompt in Chinese. If source material is mainly English, write the final prompt in English.',
    'If you use a fenced code block, the code block must contain only the prompt text.',
    'Never leave bracketed placeholders like [CHARACTER DESCRIPTION] or [STYLE BLOCK]. Replace every bracket with concrete copy inferred from the input.',
  ];

  if (kind === 'film_storyboard_node') {
    const panelCount = normalizedStoryboardPanelCount(storyboardPanelCount);
    const layoutHint = storyboardGridLayoutHint(panelCount);
    const skillBlock =
      storyboardSkill?.instruction.trim()
        ? [
            '',
            `Selected storyboard Skill: ${storyboardSkill.name}.`,
            `Apply this Skill as the director-style and shot-design focus for the ${panelCount}-panel storyboard prompt. It must not change the output contract: still return one paste-ready prompt for a single storyboard grid/sheet image with exactly ${panelCount} panels, not JSON, not a shot table, and not an explanation.`,
            storyboardSkill.instruction.trim(),
          ]
        : [];
    return [
      ...base,
      '',
      'Template 2: Cinematic Storyboard Grid.',
      `Generate one prompt for a single storyboard sheet image containing exactly ${panelCount} sequential storyboard panels for one continuous scene.`,
      `Required layout: ${layoutHint}. Do not add extra panels, do not leave empty panels, and do not force the result into 3x3 unless the required panel count is 9.`,
      'Use short director-style beats, not prose. Each panel must advance action and vary framing.',
      'Each panel needs a thin annotation strip under it with three short uppercase lines: CAM, MOVE, and MOOD. Use VOICE instead of MOOD for vlog/dialogue-driven scenes, or STYLE instead of MOOD for action/martial-arts scenes.',
      'Character descriptions must be one tight sentence each. If input lacks specifics, infer conservative defaults from the scene.',
      'Default visual style: cinematic live-action, photorealistic, lifelike, 35mm film grain, 16:9 page layout, unless the input clearly asks otherwise.',
      ...skillBlock,
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
    'When the app-provided mode is uncertain, inspect the attached image and source text: use B for a visible storyboard panel grid/sheet, C for character reference plus storyboard grid, otherwise A.',
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
  if (summary.storyboardTables.length > 0) {
    parts.push(`STORYBOARD SHOT LISTS / TABLES:\n${summary.storyboardTables.join('\n\n---\n\n')}`);
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
      ? 'A reference image is attached. First inspect the image and choose Mode A if it is a full reference, or Mode B if it is partial. The uploaded image is the identity anchor. Preserve visible identity exactly and complete only missing areas conservatively.'
      : 'No reference image is attached. Use Mode C description-only character sheet generation from the available text.',
    'Generate one professional character-sheet prompt according to AI_CHARACTER_SHEET_GPT55_SKILL.',
    'The final prompt must be a single paste-ready image generation prompt. No commentary, no JSON, no placeholders.',
    '',
    'SOURCE MATERIAL:',
    formatSourceSummary(summary),
  ].join('\n');
}

export function buildStoryboardGridUserPrompt(
  summary: AiFilmmakingSourceSummary,
  storyboardSkill?: AiFilmStoryboardSkillPrompt,
): string {
  const panelCount = normalizedStoryboardPanelCount(summary.storyboardPanelCount);
  const layoutHint = storyboardGridLayoutHint(panelCount);
  return [
    'Generate Template 2 Cinematic Storyboard Grid prompt from the source material.',
    `Output one complete prompt for a ${panelCount}-panel continuous storyboard sheet.`,
    `Layout requirement: ${layoutHint}.`,
    'Fill all details concretely; no placeholders. Use concise beats and legible annotation strip instructions.',
    summary.storyboardTables.length > 0
      ? `A storyboard shot list/table is connected. Treat it as the primary source: preserve shot order, scene logic, camera/action/dialogue details, and map the connected shots one-to-one into exactly ${panelCount} storyboard panels according to the active storyboard Skill. Do not condense, expand, or invent extra filler panels.`
      : '',
    storyboardSkill?.name ? `Active storyboard Skill: ${storyboardSkill.name}.` : '',
    '',
    'SOURCE MATERIAL:',
    formatSourceSummary(summary),
  ]
    .filter((line) => line !== '')
    .join('\n');
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
