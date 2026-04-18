export const PIPELINE_STAGE_DEFINITIONS = [
  {
    id: 'clean',
    label: 'Nettoyage',
    description: 'Retire les informations sensibles détectées dans les PDF.',
  },
  {
    id: 'watermark',
    label: 'Filigrane',
    description: 'Ajoute le nom du destinataire sur chaque page.',
  },
  {
    id: 'metadata',
    label: 'Métadonnées',
    description: 'Nettoie les métadonnées et renseigne le destinataire.',
  },
  {
    id: 'restriction',
    label: 'Restrictions PDF',
    description: 'Protège les fichiers contre impression, extraction et modification.',
  },
] as const;

export type PipelineStageDefinition = (typeof PIPELINE_STAGE_DEFINITIONS)[number];
export type PipelineStageId = PipelineStageDefinition['id'];
export type PipelineStageSelection = Record<PipelineStageId, boolean>;

export const PIPELINE_STAGE_IDS = PIPELINE_STAGE_DEFINITIONS.map((stage) => stage.id) as PipelineStageId[];

export function isPipelineStageId(value: string): value is PipelineStageId {
  return (PIPELINE_STAGE_IDS as readonly string[]).includes(value);
}

export function createDefaultPipelineStageSelection(): PipelineStageSelection {
  return PIPELINE_STAGE_IDS.reduce((selection, stageId) => {
    selection[stageId] = true;
    return selection;
  }, {} as PipelineStageSelection);
}

export function normalizePipelineStageSelection(
  input?: Partial<Record<string, boolean>>,
): PipelineStageSelection {
  const selection = createDefaultPipelineStageSelection();

  if (!input) {
    return selection;
  }

  for (const stageId of PIPELINE_STAGE_IDS) {
    if (Object.prototype.hasOwnProperty.call(input, stageId)) {
      selection[stageId] = Boolean(input[stageId]);
    }
  }

  return selection;
}

export function activePipelineStageIds(selection: PipelineStageSelection): PipelineStageId[] {
  return PIPELINE_STAGE_IDS.filter((stageId) => selection[stageId]);
}
