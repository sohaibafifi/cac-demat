import type { ElectronApi } from '../electron/preload.js';

type ReviewerSummaryFile = {
  name: string;
  missing: boolean;
  manual: boolean;
  manualIndex: number | null;
  source: 'csv' | 'manual';
  label?: string;
};

type ReviewerSummary = {
  name: string;
  hasCsv: boolean;
  hasManual: boolean;
  hasMissing: boolean;
  files: ReviewerSummaryFile[];
};

type PipelineProgressState = {
  active: boolean;
  total: number;
  completed: number;
  currentFile: string | null;
  currentRecipient: string | null;
  mode: 'reviewers' | 'members' | null;
};

type PipelineStageId = 'clean' | 'watermark' | 'metadata' | 'restriction';

type PipelineStageDefinition = {
  id: PipelineStageId;
  label: string;
  description: string;
};

type PipelineStageSelection = Record<PipelineStageId, boolean>;

type PdfRestrictionOptionId = 'print' | 'extract' | 'modify';

type PdfRestrictionOptionDefinition = {
  id: PdfRestrictionOptionId;
  label: string;
  description: string;
};

type PdfRestrictionSelection = Record<PdfRestrictionOptionId, boolean>;

type CoordinatorState = {
  folder: string | null;
  csvReviewers: string[];
  csvMembers: string[];
  availableFiles: string[];
  reviewersFromCsv: Array<{ file: string; reviewers: string[]; source: 'csv'; label?: string }>;
  reviewersManual: Array<{ file: string; reviewers: string[]; source: 'manual' }>;
  membersFromCsv: Array<{ name: string; files: string[]; source: 'csv' }>;
  membersManual: Array<{ name: string; files: string[]; source: 'manual' }>;
  missingReviewerFiles: string[];
  missingReviewerNames: string[];
  reviewerSummaries: ReviewerSummary[];
  combinedMembers: Array<{ name: string; files: string[] }>;
  log: string;
  runErrors: string[];
  status: string;
  running: boolean;
  cacName: string;
  cacType: 'avancement' | 'ripec';
  zipReviewersEnabled: boolean;
  zipMembersEnabled: boolean;
  pipelineStages: PipelineStageDefinition[];
  reviewerStageSelection: PipelineStageSelection;
  memberStageSelection: PipelineStageSelection;
  pdfRestrictionOptions: PdfRestrictionOptionDefinition[];
  reviewerRestrictionSelection: PdfRestrictionSelection;
  memberRestrictionSelection: PdfRestrictionSelection;
  canRunReviewers: boolean;
  canRunMembers: boolean;
  lastReviewerOutputDir: string | null;
  lastMemberOutputDir: string | null;
  lastRunMode: 'reviewers' | 'members' | null;
  lastRunStats: {
    runId: number;
    mode: 'reviewers' | 'members';
    requested: number;
    recipients: number;
    files: number;
    missing: number;
    errors: number;
    outputDir: string;
  } | null;
  progress: PipelineProgressState;
};

type ReviewerDepositReportGenerationResult = {
  rootDir: string;
  reportPath: string;
  generatedAt: string;
  summary: {
    reviewers: number;
    expectedReports: number;
    receivedReports: number;
    matchedReports: number;
    probableReports: number;
    missingReports: number;
    extraDeposits: number;
    unreadableZips: number;
    directDirectoriesWithoutZip: number;
  };
};

declare global {
  interface Window {
    electronAPI?: ElectronApi;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const FALLBACK_PIPELINE_STAGES: PipelineStageDefinition[] = [
  {
    id: 'clean',
    label: 'Nettoyage',
    description: 'Retire les informations sensibles détectées.',
  },
  {
    id: 'watermark',
    label: 'Filigrane',
    description: 'Ajoute le nom du destinataire sur chaque page.',
  },
  {
    id: 'metadata',
    label: 'Métadonnées',
    description: 'Nettoie les propriétés PDF et renseigne le destinataire.',
  },
  {
    id: 'restriction',
    label: 'Restrictions PDF',
    description: 'Empêche impression, extraction et modification.',
  },
];

const PIPELINE_STAGE_IDS = FALLBACK_PIPELINE_STAGES.map((stage) => stage.id);

const FALLBACK_PDF_RESTRICTION_OPTIONS: PdfRestrictionOptionDefinition[] = [
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
];

const PDF_RESTRICTION_OPTION_IDS = FALLBACK_PDF_RESTRICTION_OPTIONS.map((option) => option.id);

function createDefaultStageSelection(): PipelineStageSelection {
  return PIPELINE_STAGE_IDS.reduce((selection, stageId) => {
    selection[stageId] = true;
    return selection;
  }, {} as PipelineStageSelection);
}

function normalizeStageSelection(input?: Partial<Record<PipelineStageId, boolean>>): PipelineStageSelection {
  const selection = createDefaultStageSelection();

  if (!input) {
    return selection;
  }

  PIPELINE_STAGE_IDS.forEach((stageId) => {
    if (Object.prototype.hasOwnProperty.call(input, stageId)) {
      selection[stageId] = Boolean(input[stageId]);
    }
  });

  return selection;
}

function createDefaultRestrictionSelection(): PdfRestrictionSelection {
  return PDF_RESTRICTION_OPTION_IDS.reduce((selection, optionId) => {
    selection[optionId] = true;
    return selection;
  }, {} as PdfRestrictionSelection);
}

function normalizeRestrictionSelection(input?: Partial<Record<PdfRestrictionOptionId, boolean>>): PdfRestrictionSelection {
  const selection = createDefaultRestrictionSelection();

  if (!input) {
    return selection;
  }

  PDF_RESTRICTION_OPTION_IDS.forEach((optionId) => {
    if (Object.prototype.hasOwnProperty.call(input, optionId)) {
      selection[optionId] = Boolean(input[optionId]);
    }
  });

  return selection;
}

function isPipelineStageId(value: string): value is PipelineStageId {
  return PIPELINE_STAGE_IDS.includes(value as PipelineStageId);
}

function isPdfRestrictionOptionId(value: string): value is PdfRestrictionOptionId {
  return PDF_RESTRICTION_OPTION_IDS.includes(value as PdfRestrictionOptionId);
}

const trimPdfExtension = (value: string): string => {
  const label = value.trim();
  return label.replace(/\.pdf$/i, '').trim() || label;
};

const resolveElectronApi = async (attempts = 40, interval = 50): Promise<ElectronApi | null> => {
  if (window.electronAPI) {
    return window.electronAPI;
  }

  for (let index = 0; index < attempts; index += 1) {
    await wait(interval);
    if (window.electronAPI) {
      return window.electronAPI;
    }
  }

  return window.electronAPI ?? null;
};

let electronApiWarningShown = false;

const getElectronApiOrWarn = async (): Promise<ElectronApi | null> => {
  const api = await resolveElectronApi();

  if (!api && !electronApiWarningShown) {
    electronApiWarningShown = true;
    console.error('[renderer] Electron preload bridge unavailable.');
    alert('L\'intégration Electron est indisponible. Veuillez vérifier la configuration du preload.');
  }

  return api;
};

let currentState: CoordinatorState | null = null;
let busy = false;
let assignmentTab: 'reviewers' | 'members' | 'reporting' | 'sharing' = 'reviewers';
let advancedMode = false;
let lastRunNotificationId: number | null = null;
let progressStartedAt: number | null = null;
let lastProgressElapsedMs: number | null = null;
let progressTickerId: number | null = null;
let lastReviewerReportingPath: string | null = null;

const elements = {
  folderPath: document.getElementById('folder-path') as HTMLElement,
  reviewersCsvPath: document.getElementById('reviewers-csv-path') as HTMLElement,
  membersCsvPath: document.getElementById('members-csv-path') as HTMLElement,
  logOutput: document.getElementById('log-output') as HTMLTextAreaElement,
  errorPanel: document.getElementById('error-panel') as HTMLElement,
  errorOutput: document.getElementById('error-output') as HTMLElement,
  statusBadge: document.getElementById('status-badge') as HTMLElement,
  statusHint: document.getElementById('status-hint') as HTMLElement,
  missingFiles: document.getElementById('missing-files') as HTMLElement,
  reviewerSummaries: document.getElementById('reviewer-summaries') as HTMLElement,
  manualReviewersList: document.getElementById('manual-reviewers-list') as HTMLElement,
  manualMembersList: document.getElementById('manual-members-list') as HTMLElement,
  membersSelected: document.getElementById('members-selected') as HTMLElement,
  cacNameInput: document.getElementById('cac-name') as HTMLInputElement,
  cacTypeSelect: document.getElementById('cac-type') as HTMLSelectElement,
  manualReviewerFile: document.getElementById('manual-reviewer-file') as HTMLInputElement,
  manualReviewerNames: document.getElementById('manual-reviewer-names') as HTMLInputElement,
  manualMemberName: document.getElementById('manual-member-name') as HTMLInputElement,
  manualMemberFiles: document.getElementById('manual-member-files') as HTMLInputElement,
  runReviewers: document.getElementById('run-reviewers') as HTMLButtonElement,
  runMembers: document.getElementById('run-members') as HTMLButtonElement,
  stopPipeline: document.getElementById('stop-pipeline') as HTMLButtonElement,
  openFolder: document.getElementById('open-folder') as HTMLButtonElement,
  zipReviewersToggle: document.getElementById('zip-reviewers-enabled') as HTMLInputElement,
  zipMembersToggle: document.getElementById('zip-members-enabled') as HTMLInputElement,
  reviewerStageOptions: document.getElementById('reviewer-stage-options') as HTMLElement,
  memberStageOptions: document.getElementById('member-stage-options') as HTMLElement,
  openReviewersCsv: document.getElementById('open-reviewers-csv') as HTMLButtonElement,
  openMembersCsv: document.getElementById('open-members-csv') as HTMLButtonElement,
  selectFolder: document.getElementById('select-folder') as HTMLButtonElement,
  resetSession: document.getElementById('reset-session') as HTMLButtonElement,
  loadReviewersCsv: document.getElementById('load-reviewers-csv') as HTMLButtonElement,
  resetReviewersCsv: document.getElementById('reset-reviewers-csv') as HTMLButtonElement,
  loadMembersCsv: document.getElementById('load-members-csv') as HTMLButtonElement,
  resetMembersCsv: document.getElementById('reset-members-csv') as HTMLButtonElement,
  manualReviewerForm: document.getElementById('manual-reviewer-form') as HTMLFormElement,
  manualMemberForm: document.getElementById('manual-member-form') as HTMLFormElement,
  openOutputReviewers: document.getElementById('open-output-reviewers') as HTMLButtonElement,
  openOutputMembers: document.getElementById('open-output-members') as HTMLButtonElement,
  generateReviewerReporting: document.getElementById('generate-reviewer-reporting') as HTMLButtonElement,
  openReviewerReporting: document.getElementById('open-reviewer-reporting') as HTMLButtonElement,
  reviewerReportingResult: document.getElementById('reviewer-reporting-result') as HTMLElement,
  toggleManualReviewers: document.getElementById('toggle-manual-reviewers') as HTMLButtonElement,
  toggleReviewerSummaries: document.getElementById('toggle-reviewer-summaries') as HTMLButtonElement,
  toggleMissingFiles: document.getElementById('toggle-missing-files') as HTMLButtonElement,
  toggleManualMembers: document.getElementById('toggle-manual-members') as HTMLButtonElement,
  toggleMembersSelected: document.getElementById('toggle-members-selected') as HTMLButtonElement,
  toggleLog: document.getElementById('toggle-log') as HTMLButtonElement,
  tabReviewers: document.getElementById('tab-reviewers') as HTMLButtonElement,
  tabMembers: document.getElementById('tab-members') as HTMLButtonElement,
  tabReporting: document.getElementById('tab-reporting') as HTMLButtonElement,
  tabSharing: document.getElementById('tab-sharing') as HTMLButtonElement,
  sectionGeneralInfo: document.getElementById('section-general-info') as HTMLElement,
  sectionReviewers: document.getElementById('section-reviewers') as HTMLElement,
  sectionMembers: document.getElementById('section-members') as HTMLElement,
  sectionReporting: document.getElementById('section-reporting') as HTMLElement,
  sectionSharing: document.getElementById('section-sharing') as HTMLElement,
  ocBaseUrl: document.getElementById('oc-base-url') as HTMLInputElement,
  ocLogin: document.getElementById('oc-login') as HTMLInputElement,
  ocPassword: document.getElementById('oc-password') as HTMLInputElement,
  ocRemoteRoot: document.getElementById('oc-remote-root') as HTMLInputElement,
  ocPermissions: document.getElementById('oc-permissions') as HTMLSelectElement,
  ocUploadDefault: document.getElementById('oc-upload-default') as HTMLInputElement,
  ocNotifyEmail: document.getElementById('oc-notify-email') as HTMLInputElement,
  ocNotifyEmailControl: document.getElementById('oc-notify-email-control') as HTMLElement,
  ocConnect: document.getElementById('oc-connect') as HTMLButtonElement,
  ocTestResult: document.getElementById('oc-test-result') as HTMLElement,
  ocSecurityNote: document.getElementById('oc-security-note') as HTMLElement,
  ocPickFolder: document.getElementById('oc-pick-folder') as HTMLButtonElement,
  ocFolderPath: document.getElementById('oc-folder-path') as HTMLElement,
  ocRecipientsCard: document.getElementById('oc-recipients-card') as HTMLElement,
  ocRecipientsList: document.getElementById('oc-recipients-list') as HTMLElement,
  ocRecipientCount: document.getElementById('oc-recipient-count') as HTMLElement,
  ocShareAll: document.getElementById('oc-share-all') as HTMLButtonElement,
  ocCancel: document.getElementById('oc-cancel') as HTMLButtonElement,
  ocShareSummary: document.getElementById('oc-share-summary') as HTMLElement,
  sectionActivity: document.getElementById('section-activity') as HTMLElement,
  appVersion: document.getElementById('app-version') as HTMLElement | null,
  progressContainer: document.getElementById('progress-card') as HTMLElement,
  progressFill: document.getElementById('progress-fill') as HTMLElement,
  progressLabel: document.getElementById('progress-label') as HTMLElement,
  progressDetail: document.getElementById('progress-detail') as HTMLElement,
};

function setBusy(value: boolean): void {
  busy = value;
  document.body.dataset.busy = value ? 'true' : 'false';
  updateActionStates();
}

function stopProgressTicker(): void {
  if (progressTickerId !== null) {
    window.clearInterval(progressTickerId);
    progressTickerId = null;
  }
}

function syncProgressClock(progress: PipelineProgressState): void {
  if (progress.active && progress.total > 0) {
    if (progressStartedAt === null) {
      progressStartedAt = Date.now();
      lastProgressElapsedMs = null;
    }

    if (progressTickerId === null) {
      progressTickerId = window.setInterval(() => {
        if (!currentState?.progress?.active) {
          stopProgressTicker();
          return;
        }

        renderProgress();
      }, 1000);
    }

    return;
  }

  if (progressStartedAt !== null) {
    lastProgressElapsedMs = Date.now() - progressStartedAt;
  }

  progressStartedAt = null;
  stopProgressTicker();
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function setState(state: CoordinatorState): void {
  const normalized: CoordinatorState = {
    ...state,
    csvReviewers: [...(state.csvReviewers ?? [])],
    csvMembers: [...(state.csvMembers ?? [])],
    runErrors: [...(state.runErrors ?? [])],
    zipReviewersEnabled: state.zipReviewersEnabled !== undefined ? Boolean(state.zipReviewersEnabled) : true,
    zipMembersEnabled: state.zipMembersEnabled !== undefined ? Boolean(state.zipMembersEnabled) : true,
    cacType: state.cacType === 'ripec' ? 'ripec' : 'avancement',
    pipelineStages: state.pipelineStages?.length ? state.pipelineStages : FALLBACK_PIPELINE_STAGES,
    reviewerStageSelection: normalizeStageSelection(state.reviewerStageSelection),
    memberStageSelection: normalizeStageSelection(state.memberStageSelection),
    pdfRestrictionOptions: state.pdfRestrictionOptions?.length
      ? state.pdfRestrictionOptions
      : FALLBACK_PDF_RESTRICTION_OPTIONS,
    reviewerRestrictionSelection: normalizeRestrictionSelection(state.reviewerRestrictionSelection),
    memberRestrictionSelection: normalizeRestrictionSelection(state.memberRestrictionSelection),
    progress: state.progress
      ? { ...state.progress }
      : {
          active: false,
          total: 0,
          completed: 0,
          currentFile: null,
          currentRecipient: null,
          mode: null as PipelineProgressState['mode'],
        },
  };
  syncProgressClock(normalized.progress);
  currentState = normalized;
  render();
  notifyCompletionIfNeeded(normalized);
}

function setProgressState(progress: PipelineProgressState): void {
  if (!currentState) {
    return;
  }

  const normalized: PipelineProgressState = {
    active: Boolean(progress.active),
    total: Math.max(0, progress.total || 0),
    completed: Math.max(0, progress.completed || 0),
    currentFile: progress.currentFile ?? null,
    currentRecipient: progress.currentRecipient ?? null,
    mode: progress.mode ?? null,
  };

  syncProgressClock(normalized);
  currentState = { ...currentState, progress: normalized };
  renderProgress();
}

function setAdvancedMode(enabled: boolean): void {
  advancedMode = enabled;
  document.body.dataset.advanced = enabled ? 'true' : 'false';
}

async function refreshFooterVersion(): Promise<void> {
  const target = elements.appVersion;
  if (!target) {
    return;
  }

  const fallbackLabel = 'Version inconnue';
  try {
    const api = await resolveElectronApi();
    if (!api?.getAppVersion) {
      target.textContent = fallbackLabel;
      return;
    }

    const version = await api.getAppVersion();
    target.textContent = version ? `v${version}` : fallbackLabel;
  } catch (error) {
    console.warn('[renderer] Unable to retrieve app version', error);
    target.textContent = fallbackLabel;
  }
}

function buildCompletionMessage(stats: NonNullable<CoordinatorState['lastRunStats']>): string {
  const modeLabel = stats.mode === 'reviewers' ? 'rapporteurs' : 'membres';
  const segments = [
    `${stats.recipients}/${stats.requested} destinataire(s)`,
    `${stats.files} fichier(s) généré(s)`,
  ];
  if (stats.missing > 0) {
    segments.push(`${stats.missing} fichier(s) introuvable(s) ignoré(s)`);
  }
  if (stats.errors > 0) {
    segments.push(`${stats.errors} erreur(s)`);
  }

  return [
    `Préparation ${modeLabel} ${stats.errors > 0 ? 'terminée avec erreurs' : 'terminée'}.`,
    segments.join(', '),
    `Dossier: ${stats.outputDir}`,
  ].join('\n');
}

function notifyCompletionIfNeeded(state: CoordinatorState): void {
  if (!state.lastRunStats || (state.status !== 'Terminé' && state.status !== 'Terminé avec erreurs')) {
    return;
  }

  const { lastRunStats } = state;
  if (lastRunNotificationId === lastRunStats.runId) {
    return;
  }

  lastRunNotificationId = lastRunStats.runId;
  const message = buildCompletionMessage(lastRunStats);

  const showDialog = async (): Promise<void> => {
    const api = await resolveElectronApi();
    if (api?.showMessageBox) {
      const [headline, ...rest] = message.split('\n');
      const detail = rest.join('\n').trim();
      const hasErrors = lastRunStats.errors > 0;
      const options = {
        type: hasErrors ? ('warning' as const) : ('info' as const),
        buttons: ['Fermer'],
        defaultId: 0,
        cancelId: 0,
        title: hasErrors ? 'Pipeline terminé avec erreurs' : 'Pipeline terminé',
        message: headline,
        detail: detail === '' ? undefined : detail,
      };

      try {
        await api.showMessageBox(options);
        return;
      } catch (error) {
        console.warn('[renderer] Impossible d\'afficher la boîte de dialogue', error);
      }
    }

    if (typeof alert === 'function') {
      try {
        alert(message);
      } catch {
        // ignore alert failures
      }
    }
  };

  void showDialog();

  if ('Notification' in window) {
    try {
      if (Notification.permission === 'granted') {
        new Notification('CAC Demat', { body: message });
        return;
      }

      if (Notification.permission === 'default') {
        Notification.requestPermission()
          .then((permission) => {
            if (permission === 'granted') {
              new Notification('CAC Demat', { body: message });
            } else {
              void showDialog();
            }
          })
          .catch(() => {
            void showDialog();
          });
        return;
      }
    } catch (error) {
      console.warn('[renderer] Notification non disponible', error);
    }
  }
}

function updateActionStates(): void {
  if (!currentState) {
    elements.runReviewers.disabled = true;
    elements.runMembers.disabled = true;
    elements.stopPipeline.disabled = true;
    elements.openFolder.disabled = true;
    elements.openReviewersCsv.disabled = true;
    elements.openMembersCsv.disabled = true;
    elements.resetReviewersCsv.disabled = true;
    elements.resetMembersCsv.disabled = true;
    elements.selectFolder.disabled = true;
    elements.resetSession.disabled = true;
    elements.loadReviewersCsv.disabled = true;
    elements.loadMembersCsv.disabled = true;
    elements.generateReviewerReporting.disabled = true;
    elements.openReviewerReporting.disabled = true;
    elements.cacTypeSelect.disabled = true;
    elements.zipReviewersToggle.disabled = true;
    elements.zipMembersToggle.disabled = true;
    document.querySelectorAll<HTMLInputElement>('.stage-option input[type="checkbox"], .restriction-suboption input[type="checkbox"]').forEach((input) => {
      input.disabled = true;
    });
    elements.manualReviewerForm.querySelectorAll('input, button').forEach((node) => {
      (node as HTMLInputElement | HTMLButtonElement).disabled = true;
    });
    elements.manualMemberForm.querySelectorAll('input, button').forEach((node) => {
      (node as HTMLInputElement | HTMLButtonElement).disabled = true;
    });
    return;
  }

  const hasReviewerCsv = currentState.csvReviewers.length > 0;
  const hasMemberCsv = currentState.csvMembers.length > 0;
  const state = currentState;

  elements.runReviewers.disabled = busy || !state.canRunReviewers;
  elements.runMembers.disabled = busy || !state.canRunMembers;
  elements.stopPipeline.disabled = !state.running;
  elements.openFolder.disabled = busy || !state.folder;
  elements.openReviewersCsv.disabled = busy || !hasReviewerCsv;
  elements.resetReviewersCsv.disabled = busy || !hasReviewerCsv;
  elements.openMembersCsv.disabled = busy || !hasMemberCsv;
  elements.resetMembersCsv.disabled = busy || !hasMemberCsv;
  elements.selectFolder.disabled = busy;
  elements.resetSession.disabled = busy || state.running;
  elements.loadReviewersCsv.disabled = busy;
  elements.loadMembersCsv.disabled = busy;
  elements.generateReviewerReporting.disabled = busy || state.running;
  elements.openReviewerReporting.disabled = busy || !lastReviewerReportingPath;
  elements.cacTypeSelect.disabled = busy || state.running;
  elements.zipReviewersToggle.disabled = busy || state.running;
  elements.zipMembersToggle.disabled = busy || state.running;
  const stageInputsDisabled = busy || state.running;
  document.querySelectorAll<HTMLInputElement>('.stage-option input[type="checkbox"], .restriction-suboption input[type="checkbox"]').forEach((input) => {
    const mode = input.dataset.mode;
    const isRestrictionOption = Boolean(input.dataset.restrictionOptionId);
    const restrictionStageEnabled = mode === 'members'
      ? state.memberStageSelection.restriction
      : state.reviewerStageSelection.restriction;

    input.disabled = stageInputsDisabled || (isRestrictionOption && !restrictionStageEnabled);
  });
  elements.manualReviewerForm.querySelectorAll('input, button').forEach((node) => {
    (node as HTMLInputElement | HTMLButtonElement).disabled = busy;
  });
  elements.manualMemberForm.querySelectorAll('input, button').forEach((node) => {
    (node as HTMLInputElement | HTMLButtonElement).disabled = busy;
  });
}

function formatPath(pathValue: string | null, fallback: string): string {
  return pathValue && pathValue.trim() !== '' ? pathValue : fallback;
}

function renderCsvPaths(target: HTMLElement, paths: string[], fallback: string): void {
  target.innerHTML = '';

  if (!paths || paths.length === 0) {
    target.textContent = fallback;
    target.dataset.empty = 'true';
    return;
  }

  target.dataset.empty = 'false';
  const list = document.createElement('div');
  list.className = 'path-list';

  paths.forEach((value, index) => {
    const pill = document.createElement('span');
    pill.className = 'path-pill';
    pill.textContent = paths.length > 1 ? `${index + 1}. ${value}` : value;
    list.appendChild(pill);
  });

  target.appendChild(list);
}

function render(): void {
  if (!currentState) {
    return;
  }

  elements.folderPath.textContent = formatPath(currentState.folder, 'Aucun dossier sélectionné');
  renderCsvPaths(elements.reviewersCsvPath, currentState.csvReviewers, 'Aucun fichier sélectionné');
  renderCsvPaths(elements.membersCsvPath, currentState.csvMembers, 'Aucun fichier sélectionné');

  if (elements.cacNameInput.value !== currentState.cacName) {
    elements.cacNameInput.value = currentState.cacName;
  }
  if (elements.cacTypeSelect.value !== currentState.cacType) {
    elements.cacTypeSelect.value = currentState.cacType;
  }

  elements.zipReviewersToggle.checked = Boolean(currentState.zipReviewersEnabled);
  elements.zipMembersToggle.checked = Boolean(currentState.zipMembersEnabled);
  renderStageSelectors();
  elements.logOutput.value = currentState.log ?? '';
  elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
  renderRunErrors();
  const reviewerOutput = currentState.lastReviewerOutputDir;
  const memberOutput = currentState.lastMemberOutputDir;
  elements.openOutputReviewers.disabled = !reviewerOutput;
  elements.openOutputMembers.disabled = !memberOutput;
  populateAvailableFiles();
  applyCollapsed();
  renderTabs();

  const status = currentState.status || 'En attente';
  elements.statusBadge.textContent = status;
  if (status === 'Terminé') {
    elements.statusBadge.style.background = 'rgba(34,197,94,0.18)';
    elements.statusBadge.style.color = '#166534';
  } else if (status === 'Terminé avec erreurs') {
    elements.statusBadge.style.background = 'rgba(245,158,11,0.20)';
    elements.statusBadge.style.color = '#b45309';
  } else if (status === 'Interrompu' || status === 'Arrêt en cours') {
    elements.statusBadge.style.background = 'rgba(234,88,12,0.16)';
    elements.statusBadge.style.color = '#c2410c';
  } else if (status === 'Erreur') {
    elements.statusBadge.style.background = 'rgba(248,113,113,0.18)';
    elements.statusBadge.style.color = '#b91c1c';
  } else {
    elements.statusBadge.style.background = 'rgba(37,99,235,0.18)';
    elements.statusBadge.style.color = '#1d4ed8';
  }

  elements.statusHint.textContent =
    currentState.status === 'Terminé'
      ? 'Dernière exécution réussie.'
      : currentState.status === 'Terminé avec erreurs'
        ? 'Exécution terminée, avec erreurs partielles.'
      : currentState.status === 'Erreur'
        ? 'Consultez le journal pour plus de détails.'
        : currentState.status === 'Interrompu'
          ? 'Exécution interrompue par l’utilisateur.'
          : currentState.status === 'Arrêt en cours'
            ? 'Arrêt en cours...'
            : 'Les tâches terminées apparaîtront ici.';

  renderMissingFiles();
  renderReviewerSummaries();
  renderManualReviewers();
  renderManualMembers();
  renderMembersSelected();
  renderProgress();
  updateActionStates();
}

function renderStageSelectors(): void {
  if (!currentState) {
    return;
  }

  renderStageSelector(
    elements.reviewerStageOptions,
    'reviewers',
    currentState.reviewerStageSelection,
    currentState.reviewerRestrictionSelection,
  );
  renderStageSelector(
    elements.memberStageOptions,
    'members',
    currentState.memberStageSelection,
    currentState.memberRestrictionSelection,
  );
}

function renderStageSelector(
  container: HTMLElement,
  mode: 'reviewers' | 'members',
  selection: PipelineStageSelection,
  restrictionSelection: PdfRestrictionSelection,
): void {
  container.innerHTML = '';
  const stages = currentState?.pipelineStages?.length ? currentState.pipelineStages : FALLBACK_PIPELINE_STAGES;

  stages.forEach((stage) => {
    const label = document.createElement('label');
    label.className = 'stage-option';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = selection[stage.id] !== false;
    input.dataset.mode = mode;
    input.dataset.stageId = stage.id;

    const copy = document.createElement('span');
    copy.className = 'stage-option-copy';

    const title = document.createElement('strong');
    title.textContent = stage.label;
    copy.appendChild(title);

    const description = document.createElement('small');
    description.textContent = stage.description;
    copy.appendChild(description);

    label.appendChild(input);
    label.appendChild(copy);
    container.appendChild(label);

    if (stage.id === 'restriction') {
      container.appendChild(renderRestrictionSuboptions(mode, restrictionSelection, input.checked));
    }
  });
}

function renderRestrictionSuboptions(
  mode: 'reviewers' | 'members',
  selection: PdfRestrictionSelection,
  parentEnabled: boolean,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'restriction-suboptions';
  container.dataset.enabled = parentEnabled ? 'true' : 'false';

  const options = currentState?.pdfRestrictionOptions?.length
    ? currentState.pdfRestrictionOptions
    : FALLBACK_PDF_RESTRICTION_OPTIONS;

  options.forEach((option) => {
    const label = document.createElement('label');
    label.className = 'restriction-suboption';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = selection[option.id] !== false;
    input.disabled = !parentEnabled;
    input.dataset.mode = mode;
    input.dataset.restrictionOptionId = option.id;

    const copy = document.createElement('span');
    copy.className = 'restriction-suboption-copy';

    const title = document.createElement('strong');
    title.textContent = option.label;
    copy.appendChild(title);

    const description = document.createElement('small');
    description.textContent = option.description;
    copy.appendChild(description);

    label.appendChild(input);
    label.appendChild(copy);
    container.appendChild(label);
  });

  return container;
}

function renderProgress(): void {
  if (!currentState) return;
  const container = elements.progressContainer;
  const fill = elements.progressFill;
  const label = elements.progressLabel;
  const detail = elements.progressDetail;

  if (!container || !fill || !label || !detail) {
    return;
  }

  const progress = currentState.progress ?? {
    active: false,
    total: 0,
    completed: 0,
    currentFile: null,
    currentRecipient: null,
    mode: null as CoordinatorState['lastRunMode'],
  };

  const total = Math.max(0, progress.total || 0);
  const completed = Math.min(progress.completed || 0, total || progress.completed || 0);
  const percent = total > 0 ? Math.floor((completed / total) * 100) : 0;
  const modeLabel = progress.mode === 'reviewers' ? 'Rapporteurs' : progress.mode === 'members' ? 'Membres' : null;
  const elapsedMs = progress.active
    ? (progressStartedAt !== null ? Date.now() - progressStartedAt : 0)
    : (lastProgressElapsedMs ?? 0);

  container.dataset.active = progress.active ? 'true' : 'false';
  container.dataset.mode = modeLabel ?? '';
  fill.style.width = `${Math.min(100, percent)}%`;

  if (total > 0) {
    let etaLabel = 'ETA --:--';

    if (completed > 0 && completed < total && elapsedMs > 0) {
      const remainingMs = (elapsedMs / completed) * (total - completed);
      etaLabel = `ETA ${formatDuration(remainingMs)}`;
    } else if (completed >= total) {
      etaLabel = 'ETA 00:00';
    }

    label.textContent = `${percent}% (${completed}/${total}) • ${formatDuration(elapsedMs)} • ${etaLabel}`;
  } else {
    label.textContent = 'En attente';
  }

  const parts = [];
  if (modeLabel) parts.push(modeLabel);
  if (progress.currentFile) parts.push(progress.currentFile);
  if (progress.currentRecipient) parts.push(progress.currentRecipient);

  if (currentState.status === 'Arrêt en cours') {
    detail.textContent = parts.length > 0
      ? `Arrêt en cours • ${parts.join(' • ')}`
      : 'Arrêt en cours...';
    return;
  }

  if (!progress.active && currentState.status === 'Interrompu') {
    detail.textContent = 'Pipeline interrompu.';
    return;
  }

  detail.textContent = parts.length > 0
    ? parts.join(' • ')
    : 'Pipeline en attente de tâches.';
}

function renderRunErrors(): void {
  if (!currentState) {
    return;
  }

  const panel = elements.errorPanel;
  const output = elements.errorOutput;

  if (!panel || !output) {
    return;
  }

  const runErrors = currentState.runErrors ?? [];
  panel.style.display = runErrors.length > 0 ? 'block' : 'none';
  output.textContent = runErrors.join('\n\n');
}

function renderReviewerReportingResult(result: ReviewerDepositReportGenerationResult): void {
  const summary = result.summary;
  const target = elements.reviewerReportingResult;
  target.dataset.empty = 'false';
  target.textContent = [
    `Fichier généré : ${result.reportPath}`,
    `${summary.receivedReports}/${summary.expectedReports} dépôt(s) rattaché(s), ${summary.missingReports} manquant(s), ${summary.probableReports + summary.extraDeposits} point(s) à vérifier.`,
  ].join('\n');
}

function populateAvailableFiles(): void {
  if (!currentState) return;
  const datalist = document.getElementById('available-files') as HTMLDataListElement | null;
  if (!datalist) return;

  const state = currentState;
  const existing = Array.from(datalist.children).map((opt) => (opt as HTMLOptionElement).value);
  if (existing.length === state.availableFiles.length && existing.every((v, i) => v === state.availableFiles[i])) {
    return;
  }

  datalist.innerHTML = '';
  state.availableFiles.forEach((file) => {
    const option = document.createElement('option');
    option.value = file;
    option.label = file.split('/').pop() ?? file;
    datalist.appendChild(option);
  });
}

const collapsed = {
  manualReviewers: true,
  reviewerSummaries: true,
  missingFiles: true,
  manualMembers: true,
  membersSelected: true,
  log: true,
};

function applyCollapsed(): void {
  const label = (isCollapsed: boolean) => (isCollapsed ? 'Afficher ▼' : 'Masquer ▲');

  elements.manualReviewersList.style.display = collapsed.manualReviewers ? 'none' : '';
  elements.reviewerSummaries.style.display = collapsed.reviewerSummaries ? 'none' : '';
  elements.missingFiles.style.display = collapsed.missingFiles ? 'none' : '';
  elements.manualMembersList.style.display = collapsed.manualMembers ? 'none' : '';
  elements.membersSelected.style.display = collapsed.membersSelected ? 'none' : '';
  elements.logOutput.style.display = collapsed.log ? 'none' : '';

  elements.toggleManualReviewers.textContent = label(collapsed.manualReviewers);
  elements.toggleReviewerSummaries.textContent = label(collapsed.reviewerSummaries);
  elements.toggleMissingFiles.textContent = label(collapsed.missingFiles);
  elements.toggleManualMembers.textContent = label(collapsed.manualMembers);
  elements.toggleMembersSelected.textContent = label(collapsed.membersSelected);
  elements.toggleLog.textContent = label(collapsed.log);
}

function renderTabs(): void {
  const isReviewers = assignmentTab === 'reviewers';
  const isMembers = assignmentTab === 'members';
  const isReporting = assignmentTab === 'reporting';
  const isSharing = assignmentTab === 'sharing';
  elements.tabReviewers.classList.toggle('active', isReviewers);
  elements.tabMembers.classList.toggle('active', isMembers);
  elements.tabReporting.classList.toggle('active', isReporting);
  elements.tabSharing.classList.toggle('active', isSharing);
  elements.tabReviewers.setAttribute('aria-selected', String(isReviewers));
  elements.tabMembers.setAttribute('aria-selected', String(isMembers));
  elements.tabReporting.setAttribute('aria-selected', String(isReporting));
  elements.tabSharing.setAttribute('aria-selected', String(isSharing));
  elements.sectionReviewers.setAttribute('data-hidden', isReviewers ? 'false' : 'true');
  elements.sectionMembers.setAttribute('data-hidden', isMembers ? 'false' : 'true');
  elements.sectionReporting.setAttribute('data-hidden', isReporting ? 'false' : 'true');
  elements.sectionSharing.setAttribute('data-hidden', isSharing ? 'false' : 'true');
  const hidesPipelineSections = isReporting || isSharing;
  elements.sectionGeneralInfo.setAttribute('data-hidden', hidesPipelineSections ? 'true' : 'false');
  elements.sectionActivity.setAttribute('data-hidden', hidesPipelineSections ? 'true' : 'false');
}


function renderMissingFiles(): void {
  if (!currentState) {
    return;
  }

  elements.missingFiles.innerHTML = '';
  if (currentState.missingReviewerFiles.length === 0) {
    const span = document.createElement('span');
    span.className = 'combo-muted';
    span.textContent = 'Aucun fichier manquant détecté.';
    elements.missingFiles.appendChild(span);
    return;
  }

  const labels =
    currentState.missingReviewerNames && currentState.missingReviewerNames.length === currentState.missingReviewerFiles.length
      ? currentState.missingReviewerNames
      : currentState.missingReviewerFiles;

  labels.forEach((label) => {
    const span = document.createElement('span');
    span.textContent = trimPdfExtension(label);
    elements.missingFiles.appendChild(span);
  });
}

function renderReviewerSummaries(): void {
  if (!currentState) {
    return;
  }

  elements.reviewerSummaries.innerHTML = '';
  if (currentState.reviewerSummaries.length === 0) {
    const span = document.createElement('span');
    span.style.color = '#94a3b8';
    span.textContent = 'Aucune attribution disponible.';
    elements.reviewerSummaries.appendChild(span);
    return;
  }

  currentState.reviewerSummaries.forEach((summary) => {
    const container = document.createElement('div');
    container.className = 'summary-item';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';

    const title = document.createElement('strong');
    title.textContent = summary.name;
    header.appendChild(title);

    const badges = document.createElement('div');
    badges.style.display = 'flex';
    badges.style.gap = '0.35rem';

    if (summary.hasCsv) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Fichier';
      badges.appendChild(badge);
    }

    if (summary.hasManual) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Manuel';
      badges.appendChild(badge);
    }

    if (summary.hasMissing) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Manque';
      badge.style.color = '#fda4af';
      badges.appendChild(badge);
    }

    header.appendChild(badges);
    container.appendChild(header);

    const filesRow = document.createElement('div');
    filesRow.className = 'summary-files';
    summary.files.forEach((file) => {
      const chip = document.createElement('span');
      const baseLabel = file.label ?? file.name;
      chip.textContent = file.missing ? trimPdfExtension(baseLabel) : baseLabel;
      chip.dataset.missing = file.missing ? 'true' : 'false';
      filesRow.appendChild(chip);
    });
    container.appendChild(filesRow);

    elements.reviewerSummaries.appendChild(container);
  });
}

function renderManualReviewers(): void {
  if (!currentState) {
    return;
  }

  elements.manualReviewersList.innerHTML = '';

  if (currentState.reviewersManual.length === 0) {
    const empty = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'list-meta';
    const title = document.createElement('strong');
    title.textContent = 'Aucune attribution manuelle';
    meta.appendChild(title);
    empty.appendChild(meta);
    empty.style.justifyContent = 'center';
    empty.style.color = '#94a3b8';
    elements.manualReviewersList.appendChild(empty);
    return;
  }

  currentState.reviewersManual.forEach((assignment, index) => {
    const item = document.createElement('li');

    const meta = document.createElement('div');
    meta.className = 'list-meta';

    const title = document.createElement('strong');
    title.textContent = assignment.file;
    meta.appendChild(title);

    const reviewers = document.createElement('span');
    reviewers.textContent = assignment.reviewers.join(', ');
    reviewers.style.fontSize = '0.82rem';
    reviewers.style.color = '#1d4ed8';
    meta.appendChild(reviewers);

    item.appendChild(meta);

    const removeButton = document.createElement('button');
    removeButton.className = 'danger';
    removeButton.textContent = 'Supprimer';
    removeButton.addEventListener('click', async () => {
      const api = await getElectronApiOrWarn();
      if (!api) {
        return;
      }

      await updateCoordinator(() => api.removeManualReviewer(index));
    });

    item.appendChild(removeButton);
    elements.manualReviewersList.appendChild(item);
  });
}

function renderManualMembers(): void {
  if (!currentState) {
    return;
  }

  elements.manualMembersList.innerHTML = '';

  if (currentState.membersManual.length === 0) {
    const empty = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'list-meta';
    const title = document.createElement('strong');
    title.textContent = 'Aucun membre manuel';
    meta.appendChild(title);
    empty.appendChild(meta);
    empty.style.justifyContent = 'center';
    empty.style.color = '#94a3b8';
    elements.manualMembersList.appendChild(empty);
    return;
  }

  currentState.membersManual.forEach((entry, index) => {
    const item = document.createElement('li');

    const meta = document.createElement('div');
    meta.className = 'list-meta';

    const title = document.createElement('strong');
    title.textContent = entry.name;
    meta.appendChild(title);

    const filesLine = document.createElement('span');
    const files = Array.isArray(entry.files) ? entry.files : [];
    filesLine.textContent = files.length > 0 ? files.join(', ') : 'Tous les fichiers';
    filesLine.style.fontSize = '0.82rem';
    filesLine.style.color = files.length > 0 ? '#1d4ed8' : '#64748b';
    meta.appendChild(filesLine);

    item.appendChild(meta);

    const removeButton = document.createElement('button');
    removeButton.className = 'danger';
    removeButton.textContent = 'Supprimer';
    removeButton.addEventListener('click', async () => {
      const api = await getElectronApiOrWarn();
      if (!api) {
        return;
      }

      await updateCoordinator(() => api.removeManualMember(index));
    });

    item.appendChild(removeButton);
    elements.manualMembersList.appendChild(item);
  });
}

function renderMembersSelected(): void {
  if (!currentState) {
    return;
  }

  const root = elements.membersSelected;
  root.innerHTML = '';

  const manualNames = new Set(
    (currentState.membersManual || []).map((entry) => (entry.name ?? '').toLowerCase()).filter((name) => name !== ''),
  );

  const merged = (currentState.combinedMembers || []).map((entry) => ({
    name: entry.name,
    files: Array.isArray(entry.files) ? entry.files : [],
    manual: manualNames.has((entry.name ?? '').toLowerCase()),
  }));

  if (merged.length === 0) {
    const span = document.createElement('span');
    span.style.color = '#94a3b8';
    span.textContent = 'Aucun membre sélectionné.';
    root.appendChild(span);
    return;
  }

  const list = merged.sort((a, b) => a.name.localeCompare(b.name));

  list.forEach((entry) => {
    const container = document.createElement('div');
    container.className = 'summary-item';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';

    const title = document.createElement('strong');
    title.textContent = entry.name;
    header.appendChild(title);

    if (entry.manual) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Manuel';
      header.appendChild(badge);
    }

    container.appendChild(header);

    const filesRow = document.createElement('div');
    filesRow.className = 'summary-files';

    const files = entry.files || [];
    if (files.length === 0) {
      const chip = document.createElement('span');
      chip.className = 'combo-muted';
      chip.textContent = 'Tous les fichiers';
      filesRow.appendChild(chip);
    } else {
      files.slice(0, 12).forEach((file) => {
        const chip = document.createElement('span');
        chip.textContent = file;
        filesRow.appendChild(chip);
      });
      if (files.length > 12) {
        const more = document.createElement('span');
        more.textContent = `+${files.length - 12}`;
        filesRow.appendChild(more);
      }
    }

    container.appendChild(filesRow);
    root.appendChild(container);
  });
}

async function showReviewerImportSummary(state: CoordinatorState | null): Promise<void> {
  if (!state) {
    return;
  }

  const totalAssignments = state.reviewerSummaries.length;
  const totalFoundFiles = state.reviewerSummaries.reduce(
    (sum, summary) => sum + summary.files.filter((file) => !file.missing).length,
    0,
  );
  const recipientsWithFiles = state.reviewerSummaries.filter((summary) =>
    summary.files.some((file) => !file.missing),
  ).length;

  const inferredMissingNames =
    state.missingReviewerNames && state.missingReviewerNames.length > 0
      ? state.missingReviewerNames
      : state.reviewerSummaries
          .filter((summary) => summary.files.length === 0 || summary.files.every((file) => file.missing))
          .map((summary) => summary.name)
          .filter((name) => name.trim().length > 0);

  const lines: string[] = [
    `Attributions importées : ${totalAssignments}`,
    `Rapporteurs avec fichier : ${recipientsWithFiles}/${totalAssignments}`,
    `Fichiers détectés : ${totalFoundFiles}`,
  ];

  if (inferredMissingNames.length > 0) {
    const preview = inferredMissingNames.slice(0, 8);
    lines.push('', 'Sans fichier détecté :', preview.join(', '));
    if (inferredMissingNames.length > preview.length) {
      lines.push(`… +${inferredMissingNames.length - preview.length} autre(s)`);
    }
  } else if (totalAssignments > 0) {
    lines.push('', 'Tous les rapporteurs disposent d’au moins un fichier.');
  }

  const api = await resolveElectronApi();
  if (!api?.showMessageBox) {
    return;
  }

  await api.showMessageBox({
    type: inferredMissingNames.length > 0 ? 'warning' : 'info',
    buttons: ['Fermer'],
    defaultId: 0,
    cancelId: 0,
    title: 'Import des rapporteurs',
    message:
      inferredMissingNames.length > 0
        ? 'Certaines attributions n’ont pas pu être associées à un fichier.'
        : 'Import des rapporteurs terminé.',
    detail: lines.join('\n'),
  });
}

async function showMemberImportSummary(state: CoordinatorState | null): Promise<void> {
  if (!state) {
    return;
  }

  const totalMembers = state.membersFromCsv.length;
  const membersWithSelection = state.membersFromCsv.filter((entry) => (entry.files?.length ?? 0) > 0).length;
  const membersWithAllFiles = Math.max(totalMembers - membersWithSelection, 0);
  const totalFileRefs = state.membersFromCsv.reduce((sum, entry) => sum + (entry.files?.length ?? 0), 0);

  const previewNames = state.membersFromCsv
    .map((entry) => entry.name?.trim() ?? '')
    .filter((name) => name.length > 0)
    .slice(0, 8);

  const lines: string[] = [
    `Membres importés : ${totalMembers}`,
    `Références de fichiers : ${totalFileRefs}`,
  ];

  if (membersWithSelection > 0) {
    lines.push(`Avec sélection ciblée : ${membersWithSelection}`);
  }

  if (membersWithAllFiles > 0) {
    lines.push(`Tous les fichiers attribués : ${membersWithAllFiles}`);
  }

  if (previewNames.length > 0) {
    lines.push('', 'Aperçu :', previewNames.join(', '));
    if (state.membersFromCsv.length > previewNames.length) {
      lines.push(`… +${state.membersFromCsv.length - previewNames.length} autre(s)`);
    }
  }

  const api = await resolveElectronApi();
  if (!api?.showMessageBox) {
    return;
  }

  await api.showMessageBox({
    type: totalMembers === 0 ? 'warning' : 'info',
    buttons: ['Fermer'],
    defaultId: 0,
    cancelId: 0,
    title: 'Import des membres',
    message: totalMembers === 0 ? 'Aucun membre importé.' : 'Import des membres terminé.',
    detail: lines.join('\n'),
  });
}

async function updateCoordinator(action: () => Promise<CoordinatorState>): Promise<CoordinatorState | null> {
  try {
    setBusy(true);
    const state = await action();
    setState(state);
    return state;
  } catch (error) {
    console.error(error);
    alert(formatError(error));
    return null;
  } finally {
    setBusy(false);
  }
}

async function handleStageSelectionChange(event: Event): Promise<void> {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') {
    return;
  }

  const mode = target.dataset.mode;
  const optionId = target.dataset.restrictionOptionId;
  if ((mode === 'reviewers' || mode === 'members') && optionId && isPdfRestrictionOptionId(optionId)) {
    const api = await getElectronApiOrWarn();
    if (!api?.setPdfRestrictionOptionEnabled) {
      return;
    }

    await updateCoordinator(() =>
      api.setPdfRestrictionOptionEnabled({
        mode,
        optionId,
        enabled: target.checked,
      }),
    );
    return;
  }

  const stageId = target.dataset.stageId;
  if ((mode !== 'reviewers' && mode !== 'members') || !stageId || !isPipelineStageId(stageId)) {
    return;
  }

  const api = await getElectronApiOrWarn();
  if (!api?.setPipelineStageEnabled) {
    return;
  }

  await updateCoordinator(() =>
    api.setPipelineStageEnabled({
      mode,
      stageId,
      enabled: target.checked,
    }),
  );
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Une erreur inattendue est survenue.';
}

interface SharingRecipient {
  name: string;
  absolutePath: string;
  relativePath: string;
  suggestedUsername: string;
}

type SharingOperationResult = 'success' | 'warning' | 'missing' | 'error' | 'cancelled';
type SharingVisualState = 'idle' | 'working' | 'success' | 'warning' | 'error';

type OwnCloudConfigDescription = {
  baseUrl: string;
  login: string;
  remoteRootPath: string;
  hasPassword: boolean;
  passwordStorage: 'encrypted' | 'session-only' | 'missing';
  defaultPermissions: number;
  uploadByDefault: boolean;
  notifyByEmail: boolean;
};

let sharingFolder: string | null = null;
let sharingRecipients: SharingRecipient[] = [];
let sharingPanelLoaded = false;
let sharingOperationActive = false;
let sharingBatchCancelled = false;
let sharingConnectionReady = false;
let sharingMailNotificationAvailable: boolean | null = null;

function setOwnCloudConnectionStatus(
  state: 'idle' | 'testing' | 'success' | 'error',
  message: string,
): void {
  elements.ocTestResult.dataset.state = state;
  const text = elements.ocTestResult.querySelector<HTMLElement>('[data-role="connection-text"]');
  if (text) {
    text.textContent = message;
  }
}

function renderOwnCloudPasswordState(config: OwnCloudConfigDescription): void {
  elements.ocPassword.placeholder = config.hasPassword
    ? 'Mot de passe déjà renseigné'
    : 'Mot de passe applicatif';
  if (config.passwordStorage === 'encrypted') {
    elements.ocSecurityNote.textContent = 'Mot de passe enregistré dans le stockage sécurisé du système.';
  } else if (config.passwordStorage === 'session-only') {
    elements.ocSecurityNote.textContent = 'Chiffrement indisponible: le mot de passe sera oublié à la fermeture.';
  } else {
    elements.ocSecurityNote.textContent = 'Aucun mot de passe enregistré.';
  }
}

function setOwnCloudMailNotificationAvailability(available: boolean | null): void {
  sharingMailNotificationAvailable = available;
  updateSharingActionStates();
}

function setSharingSummary(state: SharingVisualState, message: string): void {
  elements.ocShareSummary.dataset.state = state;
  elements.ocShareSummary.textContent = message;
}

function setSharingRecipientState(
  row: HTMLElement,
  state: SharingVisualState,
  statusText: string,
  resultText = '',
): void {
  row.dataset.state = state;
  const status = row.querySelector<HTMLElement>('[data-role="status"]');
  const result = row.querySelector<HTMLElement>('[data-role="result"]');
  if (status) status.textContent = statusText;
  if (result) result.textContent = resultText;
}

function prepareSharingUploadProgress(row: HTMLElement, visible: boolean): void {
  const container = row.querySelector<HTMLElement>('[data-role="upload-progress"]');
  const progress = row.querySelector<HTMLProgressElement>('[data-role="upload-progress-bar"]');
  const label = row.querySelector<HTMLElement>('[data-role="upload-progress-label"]');
  const count = row.querySelector<HTMLElement>('[data-role="upload-progress-count"]');
  if (!container || !progress || !label || !count) return;
  container.hidden = !visible;
  progress.max = 1;
  progress.value = 0;
  label.textContent = 'Préparation du téléversement...';
  count.textContent = '0/?';
}

function updateSharingUploadProgress(
  row: HTMLElement,
  current: number,
  total: number,
  labelText: string,
): void {
  const container = row.querySelector<HTMLElement>('[data-role="upload-progress"]');
  const progress = row.querySelector<HTMLProgressElement>('[data-role="upload-progress-bar"]');
  const label = row.querySelector<HTMLElement>('[data-role="upload-progress-label"]');
  const count = row.querySelector<HTMLElement>('[data-role="upload-progress-count"]');
  if (!container || !progress || !label || !count) return;
  const safeTotal = Math.max(0, total);
  const safeCurrent = Math.min(Math.max(0, current), safeTotal || 1);
  container.hidden = false;
  progress.max = safeTotal || 1;
  progress.value = safeTotal === 0 && current > 0 ? 1 : safeCurrent;
  label.textContent = labelText;
  count.textContent = safeTotal > 0 ? `${safeCurrent}/${safeTotal}` : '0/0';
}

function formatOwnCloudShareError(error: unknown, shareWith: string): string {
  const message = formatError(error)
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();
  if (/please specify a valid user/i.test(message)) {
    return `Username ownCloud introuvable: ${shareWith}. Vérifiez le username puis réessayez.`;
  }
  return message || 'Le partage ownCloud a échoué.';
}

async function initSharingPanel(): Promise<void> {
  if (sharingPanelLoaded) return;
  sharingPanelLoaded = true;
  const api = window.electronAPI;
  if (!api?.ownCloudGetConfig) return;
  try {
    const config = await api.ownCloudGetConfig() as OwnCloudConfigDescription;
    elements.ocBaseUrl.value = config.baseUrl ?? '';
    elements.ocLogin.value = config.login ?? '';
    elements.ocRemoteRoot.value = config.remoteRootPath ?? '';
    elements.ocPermissions.value = String(config.defaultPermissions ?? 1);
    elements.ocUploadDefault.checked = Boolean(config.uploadByDefault);
    elements.ocNotifyEmail.checked = Boolean(config.notifyByEmail);
    setOwnCloudMailNotificationAvailability(null);
    renderOwnCloudPasswordState(config);
    setOwnCloudConnectionStatus(
      'idle',
      config.hasPassword ? 'Configuration enregistrée, connexion à tester' : 'Connexion non configurée',
    );
    updateSharingActionStates();
  } catch (error) {
    setOwnCloudConnectionStatus('error', `Configuration illisible: ${formatError(error)}`);
  }
}

async function saveSharingConfig(): Promise<boolean> {
  const api = window.electronAPI;
  if (!api?.ownCloudSetConfig) return false;
  try {
    const passwordValue = elements.ocPassword.value;
    const payload = {
      baseUrl: elements.ocBaseUrl.value.trim(),
      login: elements.ocLogin.value.trim(),
      appPassword: passwordValue,
      keepPassword: passwordValue.length === 0,
      remoteRootPath: elements.ocRemoteRoot.value.trim(),
      defaultPermissions: Number(elements.ocPermissions.value),
      uploadByDefault: elements.ocUploadDefault.checked,
      notifyByEmail: elements.ocNotifyEmail.checked,
    };
    const config = await api.ownCloudSetConfig(payload) as OwnCloudConfigDescription;
    elements.ocPassword.value = '';
    renderOwnCloudPasswordState(config);
    return true;
  } catch (error) {
    setOwnCloudConnectionStatus('error', formatError(error));
    return false;
  }
}

async function handleSharingConnect(): Promise<void> {
  const api = window.electronAPI;
  if (!api?.ownCloudTest) return;
  sharingConnectionReady = false;
  setOwnCloudMailNotificationAvailability(null);
  updateSharingActionStates();
  setOwnCloudConnectionStatus('testing', 'Connexion en cours...');
  elements.ocConnect.disabled = true;
  if (!await saveSharingConfig()) {
    elements.ocConnect.disabled = false;
    return;
  }
  try {
    const result = await api.ownCloudTest();
    const server = [result.productName, result.serverVersion].filter(Boolean).join(' ');
    const sharing = result.sharingApiEnabled === false ? 'partage indisponible' : 'partage disponible';
    sharingConnectionReady = result.sharingApiEnabled !== false && result.webdavAvailable === true;
    setOwnCloudMailNotificationAvailability(result.mailNotificationAvailable ?? null);
    const mail = result.mailNotificationAvailable === true
      ? ', notifications e-mail disponibles'
      : result.mailNotificationAvailable === false
        ? ', notifications e-mail désactivées par le serveur'
        : '';
    setOwnCloudConnectionStatus(
      sharingConnectionReady ? 'success' : 'error',
      `${server || 'ownCloud'} connecté, ${sharing}${mail}`,
    );
  } catch (error) {
    setOwnCloudMailNotificationAvailability(null);
    setOwnCloudConnectionStatus('error', formatError(error));
  } finally {
    elements.ocConnect.disabled = false;
    updateSharingActionStates();
  }
}

async function handleSharingPickFolder(): Promise<void> {
  const api = window.electronAPI;
  if (!api?.selectFolder || !api?.ownCloudScanFolder) return;
  const folder = await api.selectFolder();
  if (!folder) return;
  try {
    const result = await api.ownCloudScanFolder(folder);
    sharingFolder = result.folder;
    sharingRecipients = result.recipients;
    elements.ocFolderPath.textContent = sharingFolder ?? folder;
    elements.ocFolderPath.dataset.empty = 'false';
    renderSharingRecipients();
  } catch (error) {
    elements.ocFolderPath.textContent = `Erreur: ${formatError(error)}`;
    elements.ocFolderPath.dataset.empty = 'true';
    sharingRecipients = [];
    renderSharingRecipients();
  }
}

function renderSharingRecipients(): void {
  elements.ocRecipientsList.innerHTML = '';
  elements.ocRecipientCount.textContent = `${sharingRecipients.length} destinataire${sharingRecipients.length > 1 ? 's' : ''}`;
  if (sharingRecipients.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sharing-empty';
    empty.textContent = sharingFolder
      ? 'Aucun sous-dossier destinataire détecté.'
      : 'Choisissez un dossier local pour afficher les destinataires.';
    elements.ocRecipientsList.appendChild(empty);
    updateSharingActionStates();
    return;
  }

  for (const recipient of sharingRecipients) {
    const row = document.createElement('div');
    row.className = 'sharing-recipient-row';
    row.dataset.recipient = recipient.name;
    row.dataset.state = 'idle';
    row.innerHTML = `
      <div class="sharing-recipient-identity">
        <strong>${escapeHtml(recipient.name)}</strong>
        <span class="sharing-recipient-status" data-role="status">En attente</span>
      </div>
      <label class="sharing-recipient-target">
        <span>Username ownCloud</span>
        <input type="text" data-role="share-with" value="${escapeHtml(recipient.suggestedUsername)}" placeholder="prenom.nom" />
      </label>
      <button type="button" class="secondary" data-role="share">Partager</button>
      <div class="sharing-upload-progress" data-role="upload-progress" hidden>
        <div class="sharing-upload-progress-head">
          <span data-role="upload-progress-label">Préparation du téléversement...</span>
          <span data-role="upload-progress-count">0/?</span>
        </div>
        <progress data-role="upload-progress-bar" max="1" value="0"></progress>
      </div>
      <details class="sharing-recipient-options">
        <summary>Options</summary>
        <div class="sharing-recipient-options-grid">
          <label>Mode
            <select data-role="mode">
              <option value="upload-and-share">Envoyer puis partager</option>
              <option value="share-only">Partager le dossier existant</option>
            </select>
          </label>
          <label>Chemin ownCloud
            <input type="text" data-role="remote-path" />
          </label>
        </div>
      </details>
      <div class="sharing-recipient-result" data-role="result"></div>
    `;
    const remoteInput = row.querySelector<HTMLInputElement>('[data-role="remote-path"]')!;
    remoteInput.value = computeDefaultRemotePath(recipient.name);
    const modeSelect = row.querySelector<HTMLSelectElement>('[data-role="mode"]')!;
    modeSelect.value = elements.ocUploadDefault.checked ? 'upload-and-share' : 'share-only';
    const button = row.querySelector<HTMLButtonElement>('[data-role="share"]')!;
    button.addEventListener('click', () => {
      void handleSharingSingle(row, recipient);
    });
    elements.ocRecipientsList.appendChild(row);
  }
  updateSharingActionStates();
}

function computeDefaultRemotePath(recipientName: string): string {
  const root = elements.ocRemoteRoot.value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const safe = recipientName.replace(/^\/+/, '').trim();
  if (!root) return `/${safe}`;
  return `${root.startsWith('/') ? root : `/${root}`}/${safe}`;
}

function updateSharingActionStates(): void {
  const sharingDisabled = sharingOperationActive || !sharingConnectionReady;
  elements.ocShareAll.disabled = sharingDisabled || sharingRecipients.length === 0;
  elements.ocCancel.disabled = !sharingOperationActive;
  elements.ocPickFolder.disabled = sharingOperationActive;
  elements.ocConnect.disabled = sharingOperationActive;
  elements.ocNotifyEmail.disabled = sharingOperationActive || sharingMailNotificationAvailable !== true;
  elements.ocNotifyEmailControl.dataset.disabled = String(elements.ocNotifyEmail.disabled);
  if (sharingOperationActive) {
    elements.ocNotifyEmailControl.title = 'Une opération de partage est en cours.';
  } else if (sharingMailNotificationAvailable === false) {
    elements.ocNotifyEmailControl.title = 'Les notifications par e-mail sont désactivées sur le serveur ownCloud.';
  } else if (sharingMailNotificationAvailable === null) {
    elements.ocNotifyEmailControl.title = 'Testez la connexion pour vérifier cette fonction.';
  } else {
    elements.ocNotifyEmailControl.removeAttribute('title');
  }
  for (const button of Array.from(elements.ocRecipientsList.querySelectorAll<HTMLButtonElement>('[data-role="share"]'))) {
    button.disabled = sharingDisabled;
  }
}

function setSharingOperationActive(active: boolean): void {
  sharingOperationActive = active;
  updateSharingActionStates();
}

function updateSharingRecipientDefaults(): void {
  for (const row of Array.from(elements.ocRecipientsList.querySelectorAll<HTMLElement>('[data-recipient]'))) {
    const remoteInput = row.querySelector<HTMLInputElement>('[data-role="remote-path"]');
    const modeSelect = row.querySelector<HTMLSelectElement>('[data-role="mode"]');
    const recipientName = row.dataset.recipient ?? '';
    if (remoteInput) remoteInput.value = computeDefaultRemotePath(recipientName);
    if (modeSelect) modeSelect.value = elements.ocUploadDefault.checked ? 'upload-and-share' : 'share-only';
  }
}

async function shareSingleRecipient(row: HTMLElement, recipient: SharingRecipient): Promise<SharingOperationResult> {
  const api = window.electronAPI;
  if (!api?.ownCloudShareFolder) return 'error';
  const shareWithInput = row.querySelector<HTMLInputElement>('[data-role="share-with"]')!;
  const remoteInput = row.querySelector<HTMLInputElement>('[data-role="remote-path"]')!;
  const modeSelect = row.querySelector<HTMLSelectElement>('[data-role="mode"]')!;
  const shareWith = shareWithInput.value.trim();
  prepareSharingUploadProgress(row, false);
  if (!shareWith) {
    setSharingRecipientState(
      row,
      'error',
      'Username manquant',
      'Renseignez le username ownCloud du rapporteur avant le partage.',
    );
    return 'missing';
  }

  const uploadsFiles = modeSelect.value === 'upload-and-share';
  prepareSharingUploadProgress(row, uploadsFiles);
  setSharingRecipientState(
    row,
    'working',
    modeSelect.value === 'upload-and-share' ? 'Envoi et partage en cours...' : 'Partage en cours...',
  );

  try {
    const response = await api.ownCloudShareFolder({
      recipientName: recipient.name,
      localPath: recipient.absolutePath,
      remotePath: remoteInput.value.trim(),
      shareWith,
      shareType: 'user',
      permissions: Number(elements.ocPermissions.value),
      mode: modeSelect.value,
      sendNotification: elements.ocNotifyEmail.checked && !elements.ocNotifyEmail.disabled,
    });
    const uploaded = response.uploaded
      ? ` (fichiers envoyés: ${response.uploaded.uploaded}/${response.uploaded.total})`
      : '';
    if (response.uploaded) {
      updateSharingUploadProgress(
        row,
        response.uploaded.total > 0 ? response.uploaded.total : 1,
        response.uploaded.total,
        response.uploaded.total > 0 ? 'Téléversement terminé' : 'Dossier créé, aucun fichier à téléverser',
      );
    }
    const reused = response.alreadyExisted ? ' Partage déjà existant.' : '';
    const notification = response.notification as {
      requested?: boolean;
      sent?: boolean;
      alreadySent?: boolean;
      error?: string | null;
    } | undefined;
    const notificationResult = notification?.sent
      ? ' Notification e-mail envoyée.'
      : notification?.alreadySent
        ? ' Notification e-mail déjà envoyée.'
        : '';
    const shareResult = `Partage disponible pour ${response.share.shareWith}.${reused}${uploaded}${notificationResult}`;
    if (notification?.error) {
      setSharingRecipientState(
        row,
        'warning',
        'Partagé, e-mail non envoyé',
        `${shareResult} Erreur de notification: ${notification.error}`,
      );
      return 'warning';
    }
    setSharingRecipientState(row, 'success', 'Partage réussi', shareResult);
    return 'success';
  } catch (error) {
    const message = formatError(error);
    const cancelled = sharingBatchCancelled || /abort|annul/i.test(message);
    setSharingRecipientState(
      row,
      cancelled ? 'idle' : 'error',
      cancelled ? 'Annulé' : 'Échec du partage',
      cancelled ? 'Opération annulée.' : formatOwnCloudShareError(error, shareWith),
    );
    return cancelled ? 'cancelled' : 'error';
  }
}

async function handleSharingSingle(row: HTMLElement, recipient: SharingRecipient): Promise<void> {
  if (sharingOperationActive || !sharingConnectionReady) return;
  sharingBatchCancelled = false;
  setSharingOperationActive(true);
  try {
    const outcome = await shareSingleRecipient(row, recipient);
    if (outcome === 'success') {
      setSharingSummary('success', `Partage réussi pour ${recipient.name}.`);
    } else if (outcome === 'warning') {
      setSharingSummary('warning', `Partage réussi pour ${recipient.name}, mais la notification e-mail a échoué.`);
    } else if (outcome === 'error' || outcome === 'missing') {
      setSharingSummary('error', `Partage impossible pour ${recipient.name}. Consultez la ligne rouge.`);
    } else {
      setSharingSummary('idle', `Partage annulé pour ${recipient.name}.`);
    }
  } finally {
    setSharingOperationActive(false);
  }
}

async function handleSharingShareAll(): Promise<void> {
  if (sharingOperationActive || !sharingConnectionReady) return;
  const rows = Array.from(elements.ocRecipientsList.querySelectorAll<HTMLElement>('[data-recipient]'));
  let successes = 0;
  let warnings = 0;
  let errors = 0;
  let missing = 0;
  sharingBatchCancelled = false;
  setSharingSummary('idle', 'Partage en cours...');
  setSharingOperationActive(true);
  try {
    for (const row of rows) {
      if (sharingBatchCancelled) break;
      const name = row.dataset.recipient ?? '';
      const recipient = sharingRecipients.find((candidate) => candidate.name === name);
      if (!recipient) continue;
      const result = await shareSingleRecipient(row, recipient);
      if (result === 'success') successes += 1;
      if (result === 'warning') warnings += 1;
      if (result === 'error') errors += 1;
      if (result === 'missing') missing += 1;
      if (result === 'cancelled') break;
    }
  } finally {
    setSharingOperationActive(false);
  }
  const cancellation = sharingBatchCancelled ? ', traitement annulé' : '';
  const summary = `${successes} réussi(s), ${warnings} avec avertissement, ${errors} en erreur, ${missing} sans username${cancellation}.`;
  if (errors > 0 || missing > 0) {
    setSharingSummary('error', summary);
  } else if (warnings > 0) {
    setSharingSummary('warning', summary);
  } else if (sharingBatchCancelled) {
    setSharingSummary('idle', summary);
  } else {
    setSharingSummary('success', summary);
  }
}

async function handleSharingCancel(): Promise<void> {
  if (!sharingOperationActive) return;
  sharingBatchCancelled = true;
  setSharingSummary('idle', 'Annulation en cours...');
  await window.electronAPI?.ownCloudCancel?.();
}

function handleOwnCloudProgress(progress: { recipientName?: string; current?: number; total?: number; relative?: string }): void {
  const row = Array.from(elements.ocRecipientsList.querySelectorAll<HTMLElement>('[data-recipient]'))
    .find((candidate) => candidate.dataset.recipient === progress.recipientName);
  const status = row?.querySelector<HTMLElement>('[data-role="status"]');
  if (!row || !status) return;
  const current = progress.current ?? 0;
  const total = progress.total ?? 0;
  status.textContent = `Téléversement ${current}/${total}`;
  updateSharingUploadProgress(row, current, total, progress.relative ?? 'Téléversement en cours...');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function bootstrap(): Promise<void> {
  try {
    setBusy(true);
    const api = await getElectronApiOrWarn();
    if (!api) {
      throw new Error('Electron bridge unavailable.');
    }

    if (api.onCoordinatorUpdate) {
      api.onCoordinatorUpdate((state) => {
        setState(state as CoordinatorState);
      });
    }
    if (api.onCoordinatorProgress) {
      api.onCoordinatorProgress((progress) => {
        setProgressState(progress as PipelineProgressState);
      });
    }
    if (api.onOwnCloudProgress) {
      api.onOwnCloudProgress(handleOwnCloudProgress);
    }

    const state = await api.init();
    setState(state as CoordinatorState);
  } catch (error) {
    console.error(error);
    alert(formatError(error));
  } finally {
    setBusy(false);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  bootstrap().catch((error) => {
    console.error(error);
  });

  void refreshFooterVersion();

  void (async () => {
    const api = await resolveElectronApi();
    if (!api) {
      return;
    }

    try {
      const initial = await api.getAdvancedMode();
      setAdvancedMode(Boolean(initial));
    } catch (error) {
      console.warn('[renderer] Unable to retrieve advanced mode state', error);
    }

    api.onAdvancedModeChange((enabled) => {
      setAdvancedMode(Boolean(enabled));
    });
  })();

  elements.cacNameInput.addEventListener('change', async (event) => {
    if (!currentState) {
      return;
    }

    const api = await getElectronApiOrWarn();
    if (!api) {
      return;
    }

    const value = (event.target as HTMLInputElement).value;
    await updateCoordinator(() => api.setCacName(value));
  });

  elements.cacTypeSelect.addEventListener('change', async (event) => {
    const value = (event.target as HTMLSelectElement).value === 'ripec' ? 'ripec' : 'avancement';
    const api = await getElectronApiOrWarn();
    if (!api?.setCacType) {
      return;
    }

    await updateCoordinator(() => api.setCacType(value));
  });

  elements.zipReviewersToggle.addEventListener('change', async (event) => {
    const api = await getElectronApiOrWarn();
    if (!api) {
      return;
    }

    const enabled = (event.target as HTMLInputElement).checked;
    await updateCoordinator(() => api.setZipReviewersEnabled(enabled));
  });

  elements.zipMembersToggle.addEventListener('change', async (event) => {
    const api = await getElectronApiOrWarn();
    if (!api) {
      return;
    }

    const enabled = (event.target as HTMLInputElement).checked;
    await updateCoordinator(() => api.setZipMembersEnabled(enabled));
  });

  elements.reviewerStageOptions.addEventListener('change', (event) => {
    void handleStageSelectionChange(event);
  });

  elements.memberStageOptions.addEventListener('change', (event) => {
    void handleStageSelectionChange(event);
  });

  elements.selectFolder.addEventListener('click', async () => {
    const api = await getElectronApiOrWarn();
    if (!api) {
      return;
    }

    const selected = await api.selectFolder();
    if (!selected) {
      return;
    }

    await updateCoordinator(() => api.setFolder(selected));
  });

  elements.resetSession.addEventListener('click', async () => {
    const api = await getElectronApiOrWarn();
    if (!api) {
      return;
    }

    const shouldReset = confirm(
      'Réinitialiser complètement la session ?\n\nCela effacera le dossier sélectionné, les imports CSV, les attributions manuelles, le nom du CAC, les statistiques et le journal.',
    );
    if (!shouldReset) {
      return;
    }

    await updateCoordinator(() => api.resetSession());
  });

  elements.openFolder.addEventListener('click', async () => {
    if (!currentState?.folder) {
      return;
    }

    try {
      const api = await resolveElectronApi();
      await api?.openPath(currentState.folder);
    } catch (error) {
      console.error(error);
      alert(formatError(error));
    }
  });

  elements.loadReviewersCsv.addEventListener('click', async () => {
    const api = await getElectronApiOrWarn();
    if (!api) {
      return;
    }

    const selected = await api.selectCsv();
    if (!selected) {
      return;
    }

    const state = await updateCoordinator(() => api.setReviewersCsv(selected));
    await showReviewerImportSummary(state);
  });

  elements.openReviewersCsv.addEventListener('click', async () => {
    const paths = currentState?.csvReviewers ?? [];
    if (paths.length === 0) {
      return;
    }

    try {
      const api = await resolveElectronApi();
      await api?.openPath(paths[paths.length - 1]);
    } catch (error) {
      console.error(error);
      alert(formatError(error));
    }
  });

  elements.resetReviewersCsv.addEventListener('click', async () => {
    const api = await getElectronApiOrWarn();
    if (!api) {
      return;
    }

    const shouldReset = confirm('Réinitialiser tous les imports de rapporteurs ?');
    if (!shouldReset) {
      return;
    }

    await updateCoordinator(() => api.clearReviewersCsv());
  });

  elements.loadMembersCsv.addEventListener('click', async () => {
    const api = await getElectronApiOrWarn();
    if (!api) {
      return;
    }

    const selected = await api.selectCsv();
    if (!selected) {
      return;
    }

    const state = await updateCoordinator(() => api.setMembersCsv(selected));
    await showMemberImportSummary(state);
  });

  elements.openMembersCsv.addEventListener('click', async () => {
    const paths = currentState?.csvMembers ?? [];
    if (paths.length === 0) {
      return;
    }

    try {
      const api = await resolveElectronApi();
      await api?.openPath(paths[paths.length - 1]);
    } catch (error) {
      console.error(error);
      alert(formatError(error));
    }
  });

  elements.resetMembersCsv.addEventListener('click', async () => {
    const api = await getElectronApiOrWarn();
    if (!api) {
      return;
    }

    const shouldReset = confirm('Réinitialiser tous les imports de membres ?');
    if (!shouldReset) {
      return;
    }

    await updateCoordinator(() => api.clearMembersCsv());
  });

  elements.manualReviewerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = elements.manualReviewerFile.value.trim();
    const reviewers = elements.manualReviewerNames.value.trim();

    if (!file || !reviewers) {
      alert('Merci de renseigner un fichier et au moins un rapporteur.');
      return;
    }

    const api = await getElectronApiOrWarn();
    if (!api) {
      return;
    }

    await updateCoordinator(() => api.addManualReviewer({ file, reviewers }));

    elements.manualReviewerFile.value = '';
    elements.manualReviewerNames.value = '';
  });

  elements.manualMemberForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = elements.manualMemberName.value.trim();
    const filesRaw = elements.manualMemberFiles.value.trim();
    if (!name) {
      alert('Merci de renseigner un nom.');
      return;
    }

    const api = await getElectronApiOrWarn();
    if (!api) {
      return;
    }

    await updateCoordinator(() => api.addManualMember(name, filesRaw));
    elements.manualMemberName.value = '';
    elements.manualMemberFiles.value = '';
  });

  elements.runReviewers.addEventListener('click', async () => {
    if (!currentState) {
      return;
    }

    const api = await getElectronApiOrWarn();
    if (!api) {
      return;
    }

    await updateCoordinator(() => api.runPipeline('reviewers'));
  });

  elements.runMembers.addEventListener('click', async () => {
    if (!currentState) {
      return;
    }

    const api = await getElectronApiOrWarn();
    if (!api) {
      return;
    }

    await updateCoordinator(() => api.runPipeline('members'));
  });

  elements.stopPipeline.addEventListener('click', async () => {
    const api = await getElectronApiOrWarn();
    if (!api) {
      return;
    }

    try {
      const state = await api.stopPipeline();
      if (state) {
        setState(state as CoordinatorState);
      }
    } catch (error) {
      console.error(error);
      alert(formatError(error));
    }
  });

  elements.openOutputReviewers.addEventListener('click', async () => {
    const api = await resolveElectronApi();
    const last = currentState?.lastReviewerOutputDir ?? undefined;
    if (!api || !last) {
      return;
    }
    await api.openPath(last);
  });

  elements.openOutputMembers.addEventListener('click', async () => {
    const api = await resolveElectronApi();
    const last = currentState?.lastMemberOutputDir ?? undefined;
    if (!api || !last) {
      return;
    }
    await api.openPath(last);
  });

  elements.generateReviewerReporting.addEventListener('click', async () => {
    const api = await getElectronApiOrWarn();
    if (!api?.selectFolder || !api.generateReviewerDepositReport) {
      return;
    }

    const selected = await api.selectFolder();
    if (!selected) {
      return;
    }

    try {
      setBusy(true);
      const result = await api.generateReviewerDepositReport(selected) as ReviewerDepositReportGenerationResult;
      lastReviewerReportingPath = result.reportPath;
      renderReviewerReportingResult(result);
      updateActionStates();

      if (api.openPath) {
        await api.openPath(result.reportPath);
      }
    } catch (error) {
      console.error(error);
      alert(formatError(error));
    } finally {
      setBusy(false);
    }
  });

  elements.openReviewerReporting.addEventListener('click', async () => {
    const api = await resolveElectronApi();
    if (!api?.openPath || !lastReviewerReportingPath) {
      return;
    }

    try {
      await api.openPath(lastReviewerReportingPath);
    } catch (error) {
      console.error(error);
      alert(formatError(error));
    }
  });

  elements.tabReviewers.addEventListener('click', () => {
    assignmentTab = 'reviewers';
    renderTabs();
  });
  elements.tabMembers.addEventListener('click', () => {
    assignmentTab = 'members';
    renderTabs();
  });
  elements.tabReporting.addEventListener('click', () => {
    assignmentTab = 'reporting';
    renderTabs();
  });
  elements.tabSharing.addEventListener('click', () => {
    assignmentTab = 'sharing';
    renderTabs();
    void initSharingPanel();
  });

  // Sharing panel actions
  elements.ocConnect.addEventListener('click', () => { void handleSharingConnect(); });
  elements.ocPickFolder.addEventListener('click', () => { void handleSharingPickFolder(); });
  elements.ocShareAll.addEventListener('click', () => { void handleSharingShareAll(); });
  elements.ocCancel.addEventListener('click', () => { void handleSharingCancel(); });
  elements.ocRemoteRoot.addEventListener('change', updateSharingRecipientDefaults);
  elements.ocUploadDefault.addEventListener('change', updateSharingRecipientDefaults);

  // Collapse toggles
  elements.toggleManualReviewers.addEventListener('click', () => { collapsed.manualReviewers = !collapsed.manualReviewers; applyCollapsed(); });
  elements.toggleReviewerSummaries.addEventListener('click', () => { collapsed.reviewerSummaries = !collapsed.reviewerSummaries; applyCollapsed(); });
  elements.toggleMissingFiles.addEventListener('click', () => { collapsed.missingFiles = !collapsed.missingFiles; applyCollapsed(); });
  elements.toggleManualMembers.addEventListener('click', () => { collapsed.manualMembers = !collapsed.manualMembers; applyCollapsed(); });
  elements.toggleMembersSelected.addEventListener('click', () => { collapsed.membersSelected = !collapsed.membersSelected; applyCollapsed(); });
  elements.toggleLog.addEventListener('click', () => { collapsed.log = !collapsed.log; applyCollapsed(); });

  applyCollapsed();
});
