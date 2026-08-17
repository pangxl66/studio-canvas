import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createServer } from 'vite';

const memoryStorage = new Map();
const localStorageMock = {
  getItem: (key) => memoryStorage.get(key) ?? null,
  setItem: (key, value) => memoryStorage.set(key, String(value)),
  removeItem: (key) => memoryStorage.delete(key),
  clear: () => memoryStorage.clear(),
  key: (index) => [...memoryStorage.keys()][index] ?? null,
  get length() {
    return memoryStorage.size;
  },
};

let vite;
let useStudioStore;
let createDefaultProjectSettings;
let appendProjectSettingsConstraint;
let createStudioProjectPayload;
let parseStudioProjectPayload;
let getSkillById;
let buildMountedSkillsInstructionBlock;
let listPromptStyleSkills;

before(async () => {
  globalThis.localStorage = localStorageMock;
  globalThis.window = {
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: clearTimeout,
    confirm: () => true,
    alert: () => undefined,
    location: {
      hostname: '127.0.0.1',
      origin: 'http://127.0.0.1:4173',
    },
  };
  vite = await createServer({
    root: process.cwd(),
    server: { middlewareMode: true },
    appType: 'custom',
  });
  ({ useStudioStore } = await vite.ssrLoadModule('/src/store/useStudioStore.ts'));
  ({ createDefaultProjectSettings, appendProjectSettingsConstraint } = await vite.ssrLoadModule(
    '/src/services/projectSettings.ts',
  ));
  ({ createStudioProjectPayload, parseStudioProjectPayload } = await vite.ssrLoadModule(
    '/src/services/studioProjectPersistence.ts',
  ));
  ({ getSkillById, buildMountedSkillsInstructionBlock, listPromptStyleSkills } = await vite.ssrLoadModule(
    '/src/services/skillLoader.ts',
  ));
});

beforeEach(() => {
  memoryStorage.clear();
  useStudioStore.setState({
    nodes: [],
    edges: [],
    assets: [],
    messages: [],
    undoStack: [],
    activeNodeId: null,
    selectedNodeId: null,
    detailOpen: false,
    projectSettings: createDefaultProjectSettings(),
  });
});

after(async () => {
  await vite?.close();
});

test('runtime prompt Skills remove legacy 15-second limits before reaching the model', () => {
  const skillIds = [
    'prompt/studio_canvas_prompt_spec_v2_7_camera_matching',
    'prompt/seedance2_segmented_prompt_v1',
  ];
  for (const skillId of skillIds) {
    const instruction = getSkillById(skillId)?.system_instruction ?? '';
    assert.match(instruction, /运行时时长协议｜最高优先级/);
    assert.match(instruction, /不设 15 秒硬上限/);
    assert.doesNotMatch(instruction, /每张 seedanceCard 必须在15秒以内/);
    assert.doesNotMatch(instruction, /每张分别不超过15秒/);
    assert.doesNotMatch(instruction, /时间轴必须从 00\.0s 开始，到 15\.0s 结束/);
    assert.doesNotMatch(instruction, /单次输出严格锁定为 15\.0 秒/);
  }

  const mounted = buildMountedSkillsInstructionBlock(skillIds);
  assert.equal((mounted.match(/运行时时长协议｜最高优先级/g) ?? []).length, 2);
});

test('Seedance 2.5 + 八维表演 composes v10 and loads all reference files', () => {
  const v10Id = 'prompt/seedance_2_5_multimodal_film_prompt_v10';
  const v11Id = 'prompt/seedance_2_5_multimodal_film_prompt_v11_performance';
  const v10 = getSkillById(v10Id);
  const v11 = getSkillById(v11Id);
  const visibleIds = listPromptStyleSkills().map((skill) => skill.id);

  assert.ok(v10);
  assert.ok(v11);
  assert.ok(visibleIds.includes(v10Id));
  assert.ok(visibleIds.includes(v11Id));
  assert.equal(v10.version, '10.0.0');
  assert.equal(v11.version, '11.5.1');
  assert.match(v10.system_instruction, /Seedance 2\.5 多模态影视提示词 Skill/);
  assert.doesNotMatch(v10.system_instruction, /Seedance 2\.5 \+ 八维表演/);
  assert.match(v11.system_instruction, /Seedance 2\.5 多模态影视提示词 Skill/);
  assert.match(v11.system_instruction, /Seedance 2\.5 \+ 八维表演/);
  assert.match(v11.system_instruction, /【技能参考文件：\.\/seedance-25-eight-dimensional-performance\/SKILL\.md】/);
  assert.match(v11.system_instruction, /只作为内部导演计划/);
  assert.match(v11.system_instruction, /仅生成【表演】与【时间轴】的替换正文/);
  assert.match(v11.system_instruction, /保留 v10 的时间边界、动作顺序与镜尾事实/);
  assert.match(v11.system_instruction, /AU1：眉内侧抬起/);
  assert.ok(v11.system_instruction.length > v10.system_instruction.length);
});

test('Seedance 2.5 v10 is available as a Prompt style Skill with v9 project compatibility', () => {
  const id = 'prompt/seedance_2_5_multimodal_film_prompt_v10';
  const skill = getSkillById(id);
  assert.equal(skill?.slot, 'style');
  assert.equal(skill?.version, '10.0.0');
  assert.ok(listPromptStyleSkills().some((candidate) => candidate.id === id));
  assert.equal(
    getSkillById('prompt/seedance_2_5_multimodal_film_prompt_v9')?.id,
    id,
  );
  assert.match(skill?.system_instruction ?? '', /Seedance 2\.5 多模态影视提示词 Skill/);
  assert.match(skill?.system_instruction ?? '', /# 65\. 最终输出结构｜单镜模式/);
  assert.match(skill?.system_instruction ?? '', /# 66\. 最终输出结构｜多镜头组合模式/);
  assert.match(skill?.system_instruction ?? '', /所有参考素材在最终 Prompt 中统一写成 `\|@=名称\|`/);
  assert.match(skill?.system_instruction ?? '', /多镜头组合不设置15秒最低时长/);
  assert.match(skill?.system_instruction ?? '', /时长与组合协议｜最终覆盖/);
  assert.match(skill?.system_instruction ?? '', /不使用固定默认秒数/);
  assert.doesNotMatch(skill?.system_instruction ?? '', /回退\s*15\s*秒/);
  assert.match(skill?.system_instruction ?? '', /PromptOutput JSON 作为传输容器/);
});

test('legacy project payloads migrate to a complete global-settings object', () => {
  const restored = parseStudioProjectPayload({
    version: 1,
    savedAt: 1,
    nodes: [],
    edges: [],
  });

  assert.ok(restored);
  assert.equal(restored.projectSettings.schemaVersion, 1);
  assert.equal(restored.projectSettings.aspectRatio, '16:9');
  assert.equal(restored.projectSettings.overallStyle.enabled, true);
  assert.equal(restored.projectSettings.overallStyle.text, '');
  assert.ok(restored.projectSettings.defaultSkills.storyboardSkillId);
  assert.ok(restored.projectSettings.defaultSkills.promptSkillId);
});

test('new storyboard, prompt, and film-grid nodes inherit project defaults', () => {
  const defaults = createDefaultProjectSettings();
  useStudioStore.getState().updateProjectSettings({
    ...defaults,
    aspectRatio: '21:9',
    overallStyle: { enabled: true, text: '冷峻写实的太空工业喜剧' },
  });

  const storyboardId = useStudioStore.getState().addDepartmentNode('storyboard');
  const promptId = useStudioStore.getState().addDepartmentNode('prompt');
  const gridId = useStudioStore.getState().addAiFilmStoryboardNode({ x: 900, y: 120 });
  const state = useStudioStore.getState();
  const storyboard = state.nodes.find((node) => node.id === storyboardId);
  const prompt = state.nodes.find((node) => node.id === promptId);
  const grid = state.nodes.find((node) => node.id === gridId);

  assert.equal(storyboard?.data.mounted_skills?.[0], defaults.defaultSkills.storyboardSkillId);
  assert.equal(storyboard?.data.skill_source, 'project');
  assert.equal(prompt?.data.mounted_skills?.[0], defaults.defaultSkills.promptSkillId);
  assert.equal(prompt?.data.skill_source, 'project');
  assert.equal(grid?.data.film_storyboard_aspect_ratio, '21:9');
  assert.equal(grid?.data.film_storyboard_aspect_ratio_source, 'project');
  assert.equal(grid?.data.film_storyboard_skill_id, defaults.defaultSkills.storyboardSkillId);
  assert.equal(grid?.data.film_storyboard_skill_source, 'project');
});

test('project changes update inherited nodes but preserve explicit node overrides', () => {
  const defaults = createDefaultProjectSettings();
  const inheritedId = useStudioStore.getState().addDepartmentNode('storyboard');
  const customId = useStudioStore.getState().addDepartmentNode('storyboard');
  const inheritedPromptId = useStudioStore.getState().addDepartmentNode('prompt');
  const customPromptId = useStudioStore.getState().addDepartmentNode('prompt');
  useStudioStore.getState().patchNodeData(customId, {
    mounted_skills: ['storyboard/marvel_storyboard_skill_v1'],
  }, false);
  useStudioStore.getState().patchNodeData(customPromptId, {
    mounted_skills: ['prompt/studio_canvas_prompt_spec_v2_3_production'],
  }, false);

  assert.equal(
    useStudioStore.getState().nodes.find((node) => node.id === customId)?.data.skill_source,
    'node',
  );
  assert.equal(
    useStudioStore.getState().nodes.find((node) => node.id === customPromptId)?.data.skill_source,
    'node',
  );

  useStudioStore.getState().updateProjectSettings({
    ...defaults,
    aspectRatio: '9:16',
    defaultSkills: {
      ...defaults.defaultSkills,
      storyboardSkillId: 'storyboard/vertical_short_drama_storyboard_composition_v1',
      promptSkillId: 'prompt/studio_canvas_prompt_spec_v1',
    },
  });

  const state = useStudioStore.getState();
  assert.equal(
    state.nodes.find((node) => node.id === inheritedId)?.data.mounted_skills?.[0],
    'storyboard/vertical_short_drama_storyboard_composition_v1',
  );
  assert.equal(
    state.nodes.find((node) => node.id === customId)?.data.mounted_skills?.[0],
    'storyboard/marvel_storyboard_skill_v1',
  );
  assert.equal(
    state.nodes.find((node) => node.id === inheritedPromptId)?.data.mounted_skills?.[0],
    'prompt/studio_canvas_prompt_spec_v1',
  );
  assert.equal(
    state.nodes.find((node) => node.id === customPromptId)?.data.mounted_skills?.[0],
    'prompt/studio_canvas_prompt_spec_v2_3_production',
  );
});

test('global settings round-trip with project snapshots', () => {
  const settings = {
    ...createDefaultProjectSettings(),
    revision: 4,
    aspectRatio: '21:9',
    overallStyle: { enabled: true, text: '真实电影感，克制的黑色幽默' },
  };
  const snapshot = createStudioProjectPayload([], [], {
    projectId: 'project_settings_test',
    projectName: '全局设定测试',
    projectSettings: settings,
  });
  const restored = parseStudioProjectPayload(structuredClone(snapshot));

  assert.deepEqual(restored?.projectSettings, settings);
});

test('model input receives the selected aspect and manual style without rewriting it', () => {
  const settings = {
    ...createDefaultProjectSettings(),
    aspectRatio: '21:9',
    overallStyle: { enabled: true, text: '黑色幽默；表演越认真，事件越荒唐。' },
  };
  const input = appendProjectSettingsConstraint('单场次：机库夜内。', settings);

  assert.match(input, /目标画幅：21:9/);
  assert.match(input, /黑色幽默；表演越认真，事件越荒唐。/);
  assert.match(input, /用户原文/);
});
