<div class="app-shell">
    <header class="app-header">
        <h1>Centre de Contrôle de Distribution de Documents</h1>
        <p>Générez des packages pour les rapporteurs et les membres avec filigranes, restrictions et nettoyage en quelques clics.</p>
    </header>

    <section class="section">
        <article class="control-card">
            <strong>Informations générales</strong>
            <div class="control-grid">
                <div class="field-group">
                    <label class="field-label" for="cac-name">Nom du CAC</label>
                    <p class="text-muted">Utilisé pour nommer les repertoires générés.</p>
                    <input
                        id="cac-name"
                        type="text"
                        class="text-input"
                        placeholder="Ex&nbsp;: CAC 2025"
                        wire:model.debounce.400ms="cacName"
                        @disabled($running)
                    >
                </div>
                <div class="field-group">
                    <span class="field-label">Dossier de travail</span>
                    <p class="text-muted">Choisissez le répertoire contenant les PDFs à traiter.</p>
                    <button type="button" class="btn btn-outline" wire:click="pickFolder" @disabled($running)>📁 Sélectionner un dossier</button>
                    <span class="path-chip">{{ $folder ?? 'Aucun dossier sélectionné' }}</span>
                </div>
            </div>
        </article>
    </section>

    <section class="section data-tabs-section">
        <div class="data-tabs-card">
            <header class="data-tabs-header">
                <nav class="assignment-tabs" role="tablist">
                    <button type="button" class="assignment-tab {{ $assignmentTab === 'reviewers' ? 'active' : '' }}" role="tab" aria-selected="{{ $assignmentTab === 'reviewers' ? 'true' : 'false' }}" wire:click="setAssignmentTab('reviewers')">Rapporteurs</button>
                    <button type="button" class="assignment-tab {{ $assignmentTab === 'members' ? 'active' : '' }}" role="tab" aria-selected="{{ $assignmentTab === 'members' ? 'true' : 'false' }}" wire:click="setAssignmentTab('members')">Membres</button>
                </nav>
            </header>
            <div class="assignment-panels">
                <div class="assignment-panel {{ $assignmentTab === 'reviewers' ? 'active' : '' }}" role="tabpanel">
                    <div class="tab-content">
                        <article class="control-card">
                            <strong>Attribution des rapporteurs</strong>
                            <p class="text-muted">Fichier CSV associant les rapporteurs aux PDFs sources.</p>
                            <button type="button" class="btn" wire:click="pickReviewersCsv" @disabled($running)>👥 Charger le CSV des rapporteurs</button>
                            <span class="path-chip">{{ $csvReviewers ?? 'Aucun fichier sélectionné' }}</span>
                            <div class="manual-input">
                                <p class="text-muted">Ajoutez une attribution manuellement si besoin.</p>
                                <div class="input-row">
                                    <input type="text" placeholder="Fichier PDF (ex: rapport.pdf)" list="available-files" wire:model.defer="manualReviewerFile">
                                    <input type="text" placeholder="Relecteurs (séparés par des virgules)" wire:model.defer="manualReviewerNames">
                                </div>
                                <button type="button" class="btn btn-outline" wire:click="addManualReviewer" @disabled($running)>➕ Ajouter une attribution</button>
                            </div>
                        </article>
                        <div class="tab-list-container">
                            <div class="list-header">
                                <h3 class="list-title">Relecteurs sélectionnés</h3>
                                <div class="list-actions">
                                    <button
                                        type="button"
                                        class="btn btn-primary tab-action"
                                        wire:click="runReviewers"
                                        wire:target="runReviewers"
                                        wire:loading.attr="disabled"
                                        wire:loading.class="is-loading"
                                        @disabled(! $this->canRunReviewers)
                                    >
                                        <span class="btn-label" wire:loading.remove wire:target="runReviewers">🚀 Lancer le pipeline</span>
                                        <span class="btn-progress" wire:loading wire:target="runReviewers">
                                            <span>🚀 Traitement...</span>
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        class="btn btn-outline"
                                        wire:click="openLastReviewerOutput"
                                        @disabled(! $lastReviewerOutputDir)
                                    >
                                        📂 Ouvrir le dossier
                                    </button>
                                    <button type="button" class="list-toggle btn btn-outline" wire:click="toggleReviewerList" aria-expanded="{{ $reviewerListOpen ? 'true' : 'false' }}">
                                        {{ $reviewerListOpen ? 'Masquer la liste' : 'Afficher la liste' }}
                                    </button>
                                </div>
                            </div>
                            <div class="list-body" data-collapsed="{{ $reviewerListOpen ? 'false' : 'true' }}">
                                <ul class="list-panel">
                                    @forelse ($this->reviewerSummaries as $reviewer)
                                        @php
                                            $badgeClass = $reviewer['has_manual'] && $reviewer['has_csv']
                                                ? 'badge-mixed'
                                                : ($reviewer['has_manual'] ? 'badge-manual' : '');
                                            $badgeLabel = $reviewer['has_manual'] && $reviewer['has_csv']
                                                ? 'Mixte'
                                                : ($reviewer['has_manual'] ? 'Manuel' : 'CSV');
                                        @endphp
                                        <li class="{{ $reviewer['has_missing'] ? 'list-item-warning' : '' }}">
                                            <div class="item-row">
                                                <div class="item-meta">
                                                    <span class="item-title">{{ $reviewer['name'] }}</span>
                                                    <span class="item-badge {{ $badgeClass }}">{{ $badgeLabel }}</span>
                                                </div>
                                            </div>
                                            <div class="item-files">
                                                @foreach ($reviewer['files'] as $file)
                                                    <div class="item-file {{ $file['missing'] ? 'is-missing' : '' }}">
                                                        <div class="item-file-header">
                                                            <span class="item-file-name">{{ $file['name'] }}</span>
                                                            @if ($file['manual'] && $file['manual_index'] !== null)
                                                                <button type="button" class="item-remove" wire:click="removeManualReviewer({{ $file['manual_index'] }})">✖</button>
                                                            @endif
                                                        </div>
                                                        @if ($file['missing'])
                                                            <span class="item-warning">⚠️ Fichier introuvable dans le dossier sélectionné.</span>
                                                        @endif
                                                    </div>
                                                @endforeach
                                            </div>
                                        </li>
                                    @empty
                                        <li class="empty">Aucune attribution disponible.</li>
                                    @endforelse
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="assignment-panel {{ $assignmentTab === 'members' ? 'active' : '' }}" role="tabpanel">
                    <div class="tab-content">
                        <article class="control-card">
                            <strong>Liste des membres</strong>
                            <p class="text-muted">Fichier CSV avec une colonne <code>member</code> (ou <code>membre</code>) et, optionnellement, les chemins des fichiers ou dossiers attribués.</p>
                            <button type="button" class="btn" wire:click="pickMembersCsv" @disabled($running)>🧾 Charger le fichier des membres</button>
                            <span class="path-chip">{{ $csvMembers ?? 'Aucun fichier sélectionné' }}</span>
                            <div class="manual-input">
                                <p class="text-muted">Ajoutez un membre manuellement.</p>
                                <div class="input-row">
                                    <input type="text" placeholder="Nom du membre" wire:model.defer="manualMemberName">
                                    <input
                                        type="text"
                                        placeholder="Fichiers ou dossiers (séparés par des virgules, optionnel)"
                                        wire:model.defer="manualMemberFiles"
                                        list="available-files"
                                    >
                                </div>
                                <p class="text-muted helper">
                                    💡 Formats acceptés : <code>document.pdf</code>, <code>dossier/fichier.pdf</code>, un dossier entier (<code>sample_1/</code>),
                                    la racine uniquement (<code>.</code>) ou un motif (<code>sample_*/*.pdf</code>). Laissez vide pour attribuer tous les fichiers.
                                </p>
                                <button type="button" class="btn btn-outline" wire:click="addManualMember" @disabled($running)>➕ Ajouter</button>
                            </div>
                        </article>
                        <div class="tab-list-container">
                            <div class="list-header">
                                <h3 class="list-title">Membres sélectionnés</h3>
                                <div class="list-actions">
                                    <button
                                        type="button"
                                        class="btn btn-primary tab-action"
                                        wire:click="runMembers"
                                        wire:target="runMembers"
                                        wire:loading.attr="disabled"
                                        wire:loading.class="is-loading"
                                        @disabled(! $this->canRunMembers)
                                    >
                                        <span class="btn-label" wire:loading.remove wire:target="runMembers">🛡️ Lancer le pipeline</span>
                                        <span class="btn-progress" wire:loading wire:target="runMembers">
                                            <span>Traitement...</span>
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        class="btn btn-outline"
                                        wire:click="openLastMemberOutput"
                                        @disabled(! $lastMemberOutputDir)
                                    >
                                        📂 Ouvrir le dossier
                                    </button>
                                    <button type="button" class="list-toggle btn btn-outline" wire:click="toggleMemberList" aria-expanded="{{ $memberListOpen ? 'true' : 'false' }}">
                                        {{ $memberListOpen ? 'Masquer la liste' : 'Afficher la liste' }}
                                    </button>
                                </div>
                            </div>
                            <div class="list-body" data-collapsed="{{ $memberListOpen ? 'false' : 'true' }}">
                                <ul class="list-panel">
                                    @php
                                        $combinedMembers = collect($membersFromCsv)
                                            ->map(fn ($entry) => array_merge($entry, [
                                                'manual' => false,
                                                'files' => array_values($entry['files'] ?? []),
                                            ]))
                                            ->merge(
                                                collect($membersManual)->map(fn ($entry, $index) => array_merge($entry, [
                                                    'manual' => true,
                                                    'index' => $index,
                                                    'files' => array_values($entry['files'] ?? []),
                                                ]))
                                            );
                                    @endphp
                                    @forelse ($combinedMembers as $entry)
                                        <li>
                                            <div class="item-row">
                                                <div class="item-meta">
                                                    <span class="item-title">{{ $entry['name'] }}</span>
                                                    <span class="item-badge {{ $entry['manual'] ? 'badge-manual' : '' }}">{{ $entry['manual'] ? 'Manuel' : 'CSV' }}</span>
                                                </div>
                                                @if ($entry['manual'])
                                                    <button type="button" class="item-remove" wire:click="removeManualMember({{ $entry['index'] }})">✖</button>
                                                @endif
                                            </div>
                                            @php
                                                $files = $entry['files'] ?? [];
                                                $displayLimit = 8;
                                                $total = count($files);
                                                $visibleFiles = $total > $displayLimit ? array_slice($files, 0, $displayLimit) : $files;
                                            @endphp
                                            <div class="item-files">
                                                @if ($files === [])
                                                    <div class="item-file">
                                                        <div class="item-file-header">
                                                            <span class="item-file-name text-muted">Tous les fichiers du dossier seront attribués.</span>
                                                        </div>
                                                    </div>
                                                @else
                                                    @foreach ($visibleFiles as $file)
                                                        <div class="item-file">
                                                            <div class="item-file-header">
                                                                <span class="item-file-name">{{ $file }}</span>
                                                            </div>
                                                        </div>
                                                    @endforeach
                                                    @if ($total > $displayLimit)
                                                        <div class="item-file">
                                                            <div class="item-file-header">
                                                                <span class="item-file-name text-muted">+{{ $total - $displayLimit }} autre{{ ($total - $displayLimit) > 1 ? 's' : '' }}</span>
                                                            </div>
                                                        </div>
                                                    @endif
                                                @endif
                                            </div>
                                        </li>
                                    @empty
                                        <li class="empty">Aucun membre disponible.</li>
                                    @endforelse
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <section class="collapsible-card" data-collapsed="{{ $activityCollapsed ? 'true' : 'false' }}">
        <header class="collapsible-header">
            <div class="collapsible-meta">
                <span class="collapsible-title">Journal &amp; Fichiers</span>
                <span class="badge"><strong>Statut&nbsp;:</strong> <span>{{ $status }}</span></span>
            </div>
            <button type="button" class="btn btn-outline" wire:click="toggleActivity" aria-expanded="{{ $activityCollapsed ? 'false' : 'true' }}">
                {{ $activityCollapsed ? 'Afficher les détails' : 'Masquer les détails' }}
            </button>
        </header>
        @if ($lastRunStats)
            @php
                $modeLabel = $lastRunStats['mode'] === 'reviewers' ? 'Rapporteurs' : 'Membres';
            @endphp
            <div class="activity-summary">
                <div class="summary-row">
                    <strong>Dernière exécution&nbsp;:</strong>
                    <span>{{ $modeLabel }}</span>
                </div>
                <div class="summary-metrics">
                    <span><strong>{{ $lastRunStats['recipients'] }}</strong> / {{ $lastRunStats['requested'] }} destinataire{{ $lastRunStats['requested'] > 1 ? 's' : '' }}</span>
                    <span><strong>{{ $lastRunStats['files'] }}</strong> fichier{{ $lastRunStats['files'] > 1 ? 's' : '' }}</span>
                    <span><strong>{{ $lastRunStats['missing'] }}</strong> manquant{{ $lastRunStats['missing'] > 1 ? 's' : '' }}</span>
                </div>
                <p class="text-muted summary-path">Dossier&nbsp;: {{ $lastRunStats['output_dir'] }}</p>
            </div>
        @endif
        <div class="collapsible-body" id="activity-panels">
            <nav class="activity-tabs" role="tablist">
                <button type="button" class="activity-tab {{ $activityTab === 'log' ? 'active' : '' }}" wire:click="setActivityTab('log')" role="tab" aria-selected="{{ $activityTab === 'log' ? 'true' : 'false' }}">Journal</button>
                <button type="button" class="activity-tab {{ $activityTab === 'files' ? 'active' : '' }}" wire:click="setActivityTab('files')" role="tab" aria-selected="{{ $activityTab === 'files' ? 'true' : 'false' }}">Fichiers</button>
            </nav>
            <div class="activity-panels">
                <div class="activity-panel {{ $activityTab === 'log' ? 'active' : '' }}" role="tabpanel">
                    <pre class="log-output">{{ $log }}</pre>
                </div>
                <div class="activity-panel {{ $activityTab === 'files' ? 'active' : '' }}" role="tabpanel">
                    <ul class="list-panel">
                        @forelse ($fileEntries as $entry)
                            <li>
                                <span class="item-title">{{ $entry['name'] }}</span>
                            </li>
                        @empty
                            <li class="empty">Aucun fichier trouvé.</li>
                        @endforelse
                    </ul>
                </div>
            </div>
        </div>
    </section>

    <datalist id="available-files">
        @foreach ($availableFiles as $file)
            <option value="{{ $file }}">{{ basename($file) }}</option>
        @endforeach
    </datalist>
</div>
