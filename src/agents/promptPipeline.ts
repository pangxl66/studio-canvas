import type { ApprovedAsset, PromptOutput, StoryboardOutput } from '@/types/studio';

type PromptDeltaHandler = (delta: string, accumulated: string) => void;

type PromptOutputFallback = Partial<
  Pick<PromptOutput, 'system' | 'userTemplate' | 'negative' | 'parameters'>
>;

type StructureRepairBuilder = (invalidOutput: unknown, failureReason: string) => string;

type InvokeWithStructureRepair = (params: {
  systemPrompt: string;
  userPrompt: string;
  repairUserPromptBuilder: StructureRepairBuilder;
  outputFallback: PromptOutputFallback;
  temperature?: number;
  onDelta?: PromptDeltaHandler;
  signal?: AbortSignal;
}) => Promise<PromptOutput>;

export type PromptPipelineContext = {
  brief: string;
  approvedAssets: ApprovedAsset[];
  executionSystemPrompt?: string;
  onDelta?: PromptDeltaHandler;
  signal?: AbortSignal;
};

export type PromptPipelineDeps = {
  defaultNegative: string;
  departmentSystemPrompt: string;
  departmentOutputShape: string;
  timingSystemRule: string;
  resolveAssetRefs: (approvedAssets: ApprovedAsset[]) => unknown;
  parseSourceStoryboard: (brief: string) => StoryboardOutput | null;
  buildGenerationUserMessage: (
    brief: string,
    assetRefs: unknown,
    sourceStoryboard: StoryboardOutput | null,
  ) => string;
  buildStructureRepairUserMessage: (
    brief: string,
    assetRefs: unknown,
    sourceStoryboard: StoryboardOutput | null,
    invalidOutput: unknown,
    failureReason?: string,
  ) => string;
  buildCompressionRepairUserMessage: (
    brief: string,
    assetRefs: unknown,
    sourceStoryboard: StoryboardOutput | null,
    draftOutput: PromptOutput,
  ) => string;
  buildCoverageRepairUserMessage: (
    brief: string,
    assetRefs: unknown,
    sourceStoryboard: StoryboardOutput,
    invalidOutput: PromptOutput,
    failureReason?: string,
  ) => string;
  invokeWithStructureRepair: InvokeWithStructureRepair;
  outputNeedsCompressionRepair: (output: PromptOutput) => boolean;
  normalizeOutput: (
    output: PromptOutput,
    sourceStoryboard: StoryboardOutput | null,
  ) => PromptOutput;
  validateCoverage: (
    output: PromptOutput,
    sourceStoryboard: StoryboardOutput | null,
  ) => void;
  sanitizeEllipsis: (output: PromptOutput) => PromptOutput;
};

type PromptPipelineInput = {
  brief: string;
  assetRefs: unknown;
  sourceStoryboard: StoryboardOutput | null;
  systemBase: string;
  systemPrompt: string;
  outputFallback: PromptOutputFallback;
  onDelta?: PromptDeltaHandler;
  signal?: AbortSignal;
};

type PromptGenerationPlan = {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  repairUserPromptBuilder: StructureRepairBuilder;
};

export function preparePromptPipelineInput(
  context: PromptPipelineContext,
  deps: PromptPipelineDeps,
): PromptPipelineInput {
  const brief = context.brief;
  const assetRefs = deps.resolveAssetRefs(context.approvedAssets);
  const sourceStoryboard = deps.parseSourceStoryboard(brief);
  const systemBase = context.executionSystemPrompt?.trim() || deps.departmentSystemPrompt;
  const systemPrompt = [
    systemBase,
    deps.timingSystemRule,
    `【输出 JSON 形状参考】\n${deps.departmentOutputShape}`,
  ].join('\n\n');

  return {
    brief,
    assetRefs,
    sourceStoryboard,
    systemBase,
    systemPrompt,
    outputFallback: {
      system: systemBase,
      userTemplate: brief.trim() || 'Prompt generated from current storyboard input.',
      negative: deps.defaultNegative,
      parameters: {
        engine: 'jimeng',
        aspect: '16:9',
        format: 'sd2_storyboard_dense_v2',
      },
    },
    onDelta: context.onDelta,
    signal: context.signal,
  };
}

export function buildShotGenerationPlan(
  input: PromptPipelineInput,
  deps: PromptPipelineDeps,
): PromptGenerationPlan {
  return {
    systemPrompt: input.systemPrompt,
    userPrompt: deps.buildGenerationUserMessage(
      input.brief,
      input.assetRefs,
      input.sourceStoryboard,
    ),
    repairUserPromptBuilder: (invalidOutput, failureReason) =>
      deps.buildStructureRepairUserMessage(
        input.brief,
        input.assetRefs,
        input.sourceStoryboard,
        invalidOutput,
        failureReason,
      ),
    temperature: 0.25,
  };
}

export async function generatePromptDraft(
  input: PromptPipelineInput,
  plan: PromptGenerationPlan,
  deps: PromptPipelineDeps,
): Promise<PromptOutput> {
  return deps.invokeWithStructureRepair({
    systemPrompt: plan.systemPrompt,
    userPrompt: plan.userPrompt,
    repairUserPromptBuilder: plan.repairUserPromptBuilder,
    outputFallback: input.outputFallback,
    temperature: plan.temperature,
    onDelta: input.onDelta,
    signal: input.signal,
  });
}

export async function repairPromptCompressionIfNeeded(
  input: PromptPipelineInput,
  draftOutput: PromptOutput,
  deps: PromptPipelineDeps,
): Promise<PromptOutput> {
  if (!deps.outputNeedsCompressionRepair(draftOutput)) return draftOutput;

  return deps.invokeWithStructureRepair({
    systemPrompt: input.systemPrompt,
    userPrompt: deps.buildCompressionRepairUserMessage(
      input.brief,
      input.assetRefs,
      input.sourceStoryboard,
      draftOutput,
    ),
    repairUserPromptBuilder: (invalidOutput, failureReason) =>
      deps.buildStructureRepairUserMessage(
        input.brief,
        input.assetRefs,
        input.sourceStoryboard,
        invalidOutput,
        failureReason,
      ),
    outputFallback: input.outputFallback,
    temperature: 0.2,
    onDelta: input.onDelta,
    signal: input.signal,
  });
}

export function formatPromptPipelineOutput(
  input: PromptPipelineInput,
  output: PromptOutput,
  deps: PromptPipelineDeps,
): PromptOutput {
  const normalized = deps.normalizeOutput(output, input.sourceStoryboard);
  return deps.sanitizeEllipsis(normalized);
}

export async function validateAndRepairPromptCoverage(
  input: PromptPipelineInput,
  output: PromptOutput,
  deps: PromptPipelineDeps,
): Promise<PromptOutput> {
  try {
    deps.validateCoverage(output, input.sourceStoryboard);
    return output;
  } catch (error) {
    if (!input.sourceStoryboard?.shots?.length) throw error;

    const failureReason = error instanceof Error ? error.message : String(error);
    const repairedOutput = await deps.invokeWithStructureRepair({
      systemPrompt: input.systemPrompt,
      userPrompt: deps.buildCoverageRepairUserMessage(
        input.brief,
        input.assetRefs,
        input.sourceStoryboard,
        output,
        failureReason,
      ),
      repairUserPromptBuilder: (invalidOutput, structureFailureReason) =>
        deps.buildStructureRepairUserMessage(
          input.brief,
          input.assetRefs,
          input.sourceStoryboard,
          invalidOutput,
          `${failureReason} | ${structureFailureReason}`,
        ),
      outputFallback: input.outputFallback,
      temperature: 0.2,
      onDelta: input.onDelta,
      signal: input.signal,
    });

    const normalized = deps.normalizeOutput(repairedOutput, input.sourceStoryboard);
    deps.validateCoverage(normalized, input.sourceStoryboard);
    return deps.sanitizeEllipsis(normalized);
  }
}

export async function runPromptGenerationPipeline(
  context: PromptPipelineContext,
  deps: PromptPipelineDeps,
): Promise<PromptOutput> {
  const input = preparePromptPipelineInput(context, deps);
  const plan = buildShotGenerationPlan(input, deps);
  const draftOutput = await generatePromptDraft(input, plan, deps);
  const repairedDraft = await repairPromptCompressionIfNeeded(input, draftOutput, deps);
  const formattedOutput = formatPromptPipelineOutput(input, repairedDraft, deps);
  return validateAndRepairPromptCoverage(input, formattedOutput, deps);
}
