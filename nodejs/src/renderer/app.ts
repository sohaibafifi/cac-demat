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
  status: string;
  running: boolean;
  cacName: string;
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
    outputDir: string;
  } | null;
  progress: PipelineProgressState;
};

declare global {
  interface Window {
    electronAPI?: ElectronApi;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
let assignmentTab: 'reviewers' | 'members' = 'reviewers';
let advancedMode = false;
let lastRunNotificationId: number | null = null;

const elements = {
  folderPath: document.getElementById('folder-path') as HTMLElement,
  reviewersCsvPath: document.getElementById('reviewers-csv-path') as HTMLElement,
  membersCsvPath: document.getElementById('members-csv-path') as HTMLElement,
  logOutput: document.getElementById('log-output') as HTMLTextAreaElement,
  statusBadge: document.getElementById('status-badge') as HTMLElement,
  statusHint: document.getElementById('status-hint') as HTMLElement,
  missingFiles: document.getElementById('missing-files') as HTMLElement,
  reviewerSummaries: document.getElementById('reviewer-summaries') as HTMLElement,
  manualReviewersList: document.getElementById('manual-reviewers-list') as HTMLElement,
  manualMembersList: document.getElementById('manual-members-list') as HTMLElement,
  membersSelected: document.getElementById('members-selected') as HTMLElement,
  cacNameInput: document.getElementById('cac-name') as HTMLInputElement,
  manualReviewerFile: document.getElementById('manual-reviewer-file') as HTMLInputElement,
  manualReviewerNames: document.getElementById('manual-reviewer-names') as HTMLInputElement,
  manualMemberName: document.getElementById('manual-member-name') as HTMLInputElement,
  manualMemberFiles: document.getElementById('manual-member-files') as HTMLInputElement,
  runReviewers: document.getElementById('run-reviewers') as HTMLButtonElement,
  runMembers: document.getElementById('run-members') as HTMLButtonElement,
  openFolder: document.getElementById('open-folder') as HTMLButtonElement,
  openReviewersCsv: document.getElementById('open-reviewers-csv') as HTMLButtonElement,
  openMembersCsv: document.getElementById('open-members-csv') as HTMLButtonElement,
  selectFolder: document.getElementById('select-folder') as HTMLButtonElement,
  loadReviewersCsv: document.getElementById('load-reviewers-csv') as HTMLButtonElement,
  resetReviewersCsv: document.getElementById('reset-reviewers-csv') as HTMLButtonElement,
  loadMembersCsv: document.getElementById('load-members-csv') as HTMLButtonElement,
  resetMembersCsv: document.getElementById('reset-members-csv') as HTMLButtonElement,
  manualReviewerForm: document.getElementById('manual-reviewer-form') as HTMLFormElement,
  manualMemberForm: document.getElementById('manual-member-form') as HTMLFormElement,
  openOutputReviewers: document.getElementById('open-output-reviewers') as HTMLButtonElement,
  openOutputMembers: document.getElementById('open-output-members') as HTMLButtonElement,
  toggleManualReviewers: document.getElementById('toggle-manual-reviewers') as HTMLButtonElement,
  toggleReviewerSummaries: document.getElementById('toggle-reviewer-summaries') as HTMLButtonElement,
  toggleMissingFiles: document.getElementById('toggle-missing-files') as HTMLButtonElement,
  toggleManualMembers: document.getElementById('toggle-manual-members') as HTMLButtonElement,
  toggleMembersSelected: document.getElementById('toggle-members-selected') as HTMLButtonElement,
  toggleLog: document.getElementById('toggle-log') as HTMLButtonElement,
  tabReviewers: document.getElementById('tab-reviewers') as HTMLButtonElement,
  tabMembers: document.getElementById('tab-members') as HTMLButtonElement,
  sectionReviewers: document.getElementById('section-reviewers') as HTMLElement,
  sectionMembers: document.getElementById('section-members') as HTMLElement,
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

function setState(state: CoordinatorState): void {
  const normalized = {
    ...state,
    csvReviewers: [...(state.csvReviewers ?? [])],
    csvMembers: [...(state.csvMembers ?? [])],
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

  return [
    `Préparation ${modeLabel} terminée.`,
    segments.join(', '),
    `Dossier: ${stats.outputDir}`,
  ].join('\n');
}

function notifyCompletionIfNeeded(state: CoordinatorState): void {
  if (state.status !== 'Terminé' || !state.lastRunStats) {
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
      const options = {
        type: 'info' as const,
        buttons: ['Fermer'],
        defaultId: 0,
        cancelId: 0,
        title: 'Pipeline terminé',
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
    elements.openFolder.disabled = true;
    elements.openReviewersCsv.disabled = true;
    elements.openMembersCsv.disabled = true;
    elements.resetReviewersCsv.disabled = true;
    elements.resetMembersCsv.disabled = true;
    elements.selectFolder.disabled = true;
    elements.loadReviewersCsv.disabled = true;
    elements.loadMembersCsv.disabled = true;
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

  elements.runReviewers.disabled = busy || !currentState.canRunReviewers;
  elements.runMembers.disabled = busy || !currentState.canRunMembers;
  elements.openFolder.disabled = busy || !currentState.folder;
  elements.openReviewersCsv.disabled = busy || !hasReviewerCsv;
  elements.resetReviewersCsv.disabled = busy || !hasReviewerCsv;
  elements.openMembersCsv.disabled = busy || !hasMemberCsv;
  elements.resetMembersCsv.disabled = busy || !hasMemberCsv;
  elements.selectFolder.disabled = busy;
  elements.loadReviewersCsv.disabled = busy;
  elements.loadMembersCsv.disabled = busy;
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

  elements.logOutput.value = currentState.log ?? '';
  elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
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
      : currentState.status === 'Erreur'
        ? 'Consultez le journal pour plus de détails.'
        : 'Les tâches terminées apparaîtront ici.';

  renderMissingFiles();
  renderReviewerSummaries();
  renderManualReviewers();
  renderManualMembers();
  renderMembersSelected();
  renderProgress();
  updateActionStates();
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

  container.dataset.active = progress.active ? 'true' : 'false';
  container.dataset.mode = modeLabel ?? '';
  fill.style.width = `${Math.min(100, percent)}%`;
  label.textContent = total > 0 ? `${percent}% (${completed}/${total})` : 'En attente';

  const parts = [];
  if (modeLabel) parts.push(modeLabel);
  if (progress.currentFile) parts.push(progress.currentFile);
  if (progress.currentRecipient) parts.push(progress.currentRecipient);

  detail.textContent = parts.length > 0
    ? parts.join(' • ')
    : 'Pipeline en attente de tâches.';
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
  elements.tabReviewers.classList.toggle('active', isReviewers);
  elements.tabMembers.classList.toggle('active', !isReviewers);
  elements.tabReviewers.setAttribute('aria-selected', String(isReviewers));
  elements.tabMembers.setAttribute('aria-selected', String(!isReviewers));
  elements.sectionReviewers.setAttribute('data-hidden', isReviewers ? 'false' : 'true');
  elements.sectionMembers.setAttribute('data-hidden', isReviewers ? 'true' : 'false');
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

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Une erreur inattendue est survenue.';
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

  elements.tabReviewers.addEventListener('click', () => {
    assignmentTab = 'reviewers';
    renderTabs();
  });
  elements.tabMembers.addEventListener('click', () => {
    assignmentTab = 'members';
    renderTabs();
  });

  // Collapse toggles
  elements.toggleManualReviewers.addEventListener('click', () => { collapsed.manualReviewers = !collapsed.manualReviewers; applyCollapsed(); });
  elements.toggleReviewerSummaries.addEventListener('click', () => { collapsed.reviewerSummaries = !collapsed.reviewerSummaries; applyCollapsed(); });
  elements.toggleMissingFiles.addEventListener('click', () => { collapsed.missingFiles = !collapsed.missingFiles; applyCollapsed(); });
  elements.toggleManualMembers.addEventListener('click', () => { collapsed.manualMembers = !collapsed.manualMembers; applyCollapsed(); });
  elements.toggleMembersSelected.addEventListener('click', () => { collapsed.membersSelected = !collapsed.membersSelected; applyCollapsed(); });
  elements.toggleLog.addEventListener('click', () => { collapsed.log = !collapsed.log; applyCollapsed(); });

  applyCollapsed();
});
