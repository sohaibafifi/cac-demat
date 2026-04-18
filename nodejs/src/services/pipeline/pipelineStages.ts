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

export const PDF_RESTRICTION_OPTION_DEFINITIONS = [
  {
    id: 'print',
    label: 'Impression interdite',
    description: 'Empêche l’impression du PDF.',
  },
  {
    id: 'extract',
    label: 'Copie et extraction interdites',
    description: 'Empêche la copie de texte et l’extraction de contenu.',
  },
  {
    id: 'modify',
    label: 'Modification limitée',
    description: 'Autorise seulement formulaires, signatures et annotations.',
  },
] as const;

export type PipelineStageDefinition = (typeof PIPELINE_STAGE_DEFINITIONS)[number];
export type PipelineStageId = PipelineStageDefinition['id'];
export type PipelineStageSelection = Record<PipelineStageId, boolean>;
export type PdfRestrictionOptionDefinition = (typeof PDF_RESTRICTION_OPTION_DEFINITIONS)[number];
export type PdfRestrictionOptionId = PdfRestrictionOptionDefinition['id'];
export type PdfRestrictionSelection = Record<PdfRestrictionOptionId, boolean>;

export interface PipelineExecutionOptions {
  restrictionOptions?: PdfRestrictionSelection;
}

export const PIPELINE_STAGE_IDS = PIPELINE_STAGE_DEFINITIONS.map((stage) => stage.id) as PipelineStageId[];
export const PDF_RESTRICTION_OPTION_IDS = PDF_RESTRICTION_OPTION_DEFINITIONS.map(
  (option) => option.id,
) as PdfRestrictionOptionId[];

export function isPipelineStageId(value: string): value is PipelineStageId {
  return (PIPELINE_STAGE_IDS as readonly string[]).includes(value);
}

export function isPdfRestrictionOptionId(value: string): value is PdfRestrictionOptionId {
  return (PDF_RESTRICTION_OPTION_IDS as readonly string[]).includes(value);
}

export function createDefaultPipelineStageSelection(): PipelineStageSelection {
  return PIPELINE_STAGE_IDS.reduce((selection, stageId) => {
    selection[stageId] = true;
    return selection;
  }, {} as PipelineStageSelection);
}

export function createDefaultPdfRestrictionSelection(): PdfRestrictionSelection {
  return PDF_RESTRICTION_OPTION_IDS.reduce((selection, optionId) => {
    selection[optionId] = true;
    return selection;
  }, {} as PdfRestrictionSelection);
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

export function normalizePdfRestrictionSelection(
  input?: Partial<Record<string, boolean>>,
): PdfRestrictionSelection {
  const selection = createDefaultPdfRestrictionSelection();

  if (!input) {
    return selection;
  }

  for (const optionId of PDF_RESTRICTION_OPTION_IDS) {
    if (Object.prototype.hasOwnProperty.call(input, optionId)) {
      selection[optionId] = Boolean(input[optionId]);
    }
  }

  return selection;
}

export function activePipelineStageIds(selection: PipelineStageSelection): PipelineStageId[] {
  return PIPELINE_STAGE_IDS.filter((stageId) => selection[stageId]);
}
