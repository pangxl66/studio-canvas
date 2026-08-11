import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildVideoPromptAnalysisSystemPrompt,
  buildVideoPromptCompositionUserPrompt,
  parseVideoPromptImageAnalysis,
  resolveVideoPromptDurationSec,
  validateVideoPromptText,
} from '../src/services/videoPromptSpec.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function validAnalysisJson(panelCount = 2) {
  return JSON.stringify({
    readingOrder: '从左到右、从上到下',
    sceneSummary: '夜间舱室里的两人对峙',
    globalVisualLock: '人物、服装、蓝色顶光与控制台位置不变',
    performanceBaseline: '克制、低强度、以视线和呼吸推进',
    spatialContinuity: '甲始终在画面左侧，乙始终在右侧',
    panels: Array.from({ length: panelCount }, (_, index) => ({
      panelIndex: index + 1,
      sourceShotId: `S${index + 1}`,
      visualSummary: `面板${index + 1}可见人物和控制台`,
      camera: '平视中景',
      performance: `人物先屏息，再将视线移向面板${index + 1}的声源`,
      gaze: '从控制台移向对方',
      bodyLanguage: '肩膀收紧，重心保持在后脚',
      handAction: '右手贴近控制杆但不触发',
      startState: `状态${index + 1}A`,
      endState: `状态${index + 1}B`,
      continuity: '保持左右手、站位和道具位置',
    })),
    uncertainties: [],
  });
}

test('video prompt duration has no 15s cap and still uses a 15s fallback', () => {
  assert.equal(resolveVideoPromptDurationSec(8, 12), 8);
  assert.equal(resolveVideoPromptDurationSec(42.5, 12), 42.5);
  assert.equal(resolveVideoPromptDurationSec(undefined, 7.5), 7.5);
  assert.equal(resolveVideoPromptDurationSec(undefined, 25), 25);
  assert.equal(resolveVideoPromptDurationSec(undefined, undefined), 15);
});

test('image analysis parser requires every expected panel and playable performance handoffs', () => {
  const analysis = parseVideoPromptImageAnalysis(validAnalysisJson(2), {
    expectedPanelCount: 2,
    sourceImageNodeId: 'grid-image',
    sourceImageSignature: 'image-v1',
    analyzedAt: 123,
  });
  assert.equal(analysis.panels.length, 2);
  assert.match(analysis.panels[0].performance, /屏息/);
  assert.equal(analysis.sourceImageNodeId, 'grid-image');

  assert.throws(
    () => parseVideoPromptImageAnalysis(validAnalysisJson(1), {
      expectedPanelCount: 2,
      sourceImageNodeId: 'grid-image',
      sourceImageSignature: 'image-v1',
    }),
    /1\/2 个有效面板/,
  );
});

test('vision and composition prompts separate image facts from upstream motion intent', () => {
  const system = buildVideoPromptAnalysisSystemPrompt(2);
  assert.match(system, /Read exactly 2 visible panels/);
  assert.match(system, /Performance must be observable and executable/);

  const analysis = parseVideoPromptImageAnalysis(validAnalysisJson(2), {
    expectedPanelCount: 2,
    sourceImageNodeId: 'grid-image',
    sourceImageSignature: 'image-v1',
  });
  const prompt = buildVideoPromptCompositionUserPrompt({
    analysis,
    mode: 'C',
    durationSec: 15,
    imageReferenceLines: ['@image1: 角色参考', '@image2: 九宫格 — 按连续分镜面板读取'],
    storyboardFacts: '镜头1：缓慢前推；镜头2：固定机位。',
    sourceDurationSec: 24,
  });
  assert.match(prompt, /user selected 15s/);
  assert.match(prompt, /@image2: 九宫格/);
  assert.match(prompt, /"performance"/);
});

test('final video prompt validator enforces all modules and every grid panel', () => {
  const valid = [
    'REFERENCE\n@image1 是九宫格。',
    'FORMAT\n16:9，15秒。',
    'VISUAL LOCK\n身份、服装、场景与灯光不漂移。',
    'PERFORMANCE BASELINE\n呼吸克制，视线先于转身。',
    'TIMELINE\n0:00–0:07｜面板1｜人物屏息；结束状态：右手停在控制杆上。\n0:07–0:15｜面板2｜人物抬眼；结束状态：目光落在门口。',
    'AUDIO\nNO MUSIC；仅环境声与衣料摩擦。',
    'CONTINUITY\n继承站位、左右手和道具。',
    'NEGATIVE\n禁止换脸、跳轴、字幕和水印。',
  ].join('\n\n');
  assert.deepEqual(validateVideoPromptText(valid, 2), []);
  assert.match(validateVideoPromptText(valid.replace('面板2', '第二格'), 2).join(' '), /面板 2/);
});

test('repository wires a dedicated video_prompt skill, real image analysis, streaming preview and UI controls', () => {
  const loader = read('src/services/skillLoader.ts');
  const store = read('src/store/slices/aiFilmmakingStore.ts');
  const rootStore = read('src/store/useStudioStore.ts');
  const component = read('src/components/AiFilmmakingNode.tsx');
  const promptBuilder = read('src/services/aiFilmmakingPrompts.ts');
  const skill = JSON.parse(read('src/skills/video_prompt/storyboard_grid_seedance_v1.json'));

  assert.match(loader, /DEFAULT_VIDEO_PROMPT_SKILL_ID/);
  assert.match(loader, /video_prompt/);
  assert.match(store, /imageDataUrl: primaryImage\.dataUrl/);
  assert.match(store, /buildVideoPromptAnalysisSystemPrompt/);
  assert.match(store, /now - lastPreviewAt < 160/);
  assert.match(store, /validateVideoPromptText/);
  assert.match(component, /表演与动作接力分析/);
  assert.match(component, /上游图片或分镜已变化，请重新分析/);
  assert.match(component, /重新分析并生成/);
  assert.doesNotMatch(component, /max="15"/);
  assert.doesNotMatch(component, /Math\.min\(15/);
  assert.match(component, /留空沿用上游/);
  assert.match(component, /placeholder="自动"/);
  assert.doesNotMatch(rootStore, /film_video_prompt_duration_sec:\s*15/);
  assert.match(promptBuilder, /even when it exceeds 15 seconds/);
  assert.match(skill.system_instruction, /表演是必填信息/);
  assert.match(skill.system_instruction, /不得输出旧 PromptOutput JSON/);
});
