<div class="app-shell">
    <header class="app-header">
        <h1>Centre de Contrôle de Distribution de Documents</h1>
        <p>Générez des packages pour les rapporteurs et les membres avec filigranes, restrictions et nettoyage en quelques clics.</p>
    </header>

    <section class="section">
        <article class="control-card">
            <strong>Dossier de travail</strong>
            <p class="text-muted">Choisissez le répertoire contenant les PDFs à traiter.</p>
            <button type="button" class="btn btn-outline" wire:click="pickFolder" @disabled($running)>📁 Sélectionner un dossier</button>
            <span class="path-chip">{{ $folder ?? 'Aucun dossier sélectionné' }}</span>
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
                                    <button type="button" class="list-toggle btn btn-outline" wire:click="toggleReviewerList" aria-expanded="{{ $reviewerListOpen ? 'true' : 'false' }}">
                                        {{ $reviewerListOpen ? 'Masquer la liste' : 'Afficher la liste' }}
                                    </button>
                                </div>
                            </div>
                            <div class="list-body" data-collapsed="{{ $reviewerListOpen ? 'false' : 'true' }}">
                                <ul class="list-panel">
                                    @php
                                        $combinedReviewers = collect($reviewersFromCsv)->map(fn ($assignment) => array_merge($assignment, ['manual' => false]))
                                            ->merge(collect($reviewersManual)->map(fn ($assignment, $index) => array_merge($assignment, ['manual' => true, 'index' => $index])));
                                    @endphp
                                    @forelse ($combinedReviewers as $assignment)
                                        <li>
                                            <div class="item-row">
                                                <div class="item-meta">
                                                    <span class="item-title">{{ $assignment['file'] }}</span>
                                                    <span class="item-badge {{ $assignment['manual'] ? 'badge-manual' : '' }}">{{ $assignment['manual'] ? 'Manuel' : 'CSV' }}</span>
                                                </div>
                                                @if ($assignment['manual'])
                                                    <button type="button" class="item-remove" wire:click="removeManualReviewer({{ $assignment['index'] }})">✖</button>
                                                @endif
                                            </div>
                                            <span class="item-sub">{{ collect($assignment['reviewers'] ?? [])->join(', ') ?: '—' }}</span>
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
                            <p class="text-muted">Fichier CSV contenant les membres, un par ligne.</p>
                            <button type="button" class="btn" wire:click="pickMembersCsv" @disabled($running)>🧾 Charger le fichier des membres</button>
                            <span class="path-chip">{{ $csvMembers ?? 'Aucun fichier sélectionné' }}</span>
                            <div class="manual-input">
                                <p class="text-muted">Ajoutez un membre manuellement.</p>
                                <div class="input-row">
                                    <input type="text" placeholder="Nom du membre" wire:model.defer="manualMemberName">
                                </div>
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
                                    <button type="button" class="list-toggle btn btn-outline" wire:click="toggleMemberList" aria-expanded="{{ $memberListOpen ? 'true' : 'false' }}">
                                        {{ $memberListOpen ? 'Masquer la liste' : 'Afficher la liste' }}
                                    </button>
                                </div>
                            </div>
                            <div class="list-body" data-collapsed="{{ $memberListOpen ? 'false' : 'true' }}">
                                <ul class="list-panel">
                                    @php
                                        $combinedMembers = collect($membersFromCsv)->map(fn ($entry) => array_merge($entry, ['manual' => false]))
                                            ->merge(collect($membersManual)->map(fn ($entry, $index) => array_merge($entry, ['manual' => true, 'index' => $index])));
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
                                <span class="item-sub">{{ strtoupper($entry['type']) }}</span>
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
