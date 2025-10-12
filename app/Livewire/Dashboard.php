<?php

namespace App\Livewire;

use Illuminate\Support\Facades\Log;
use Livewire\Component;
use Illuminate\Support\Str;

use App\Services\Assignments\CsvAssignmentLoader;
use App\Services\Pipeline\MemberPreparationService;
use App\Services\Pipeline\ReviewerPreparationService;
use App\Services\Workspace\WorkspaceService;
use Native\Laravel\Dialog;
use RuntimeException;

class Dashboard extends Component
{
    public ?string $folder = null;
    public ?string $csvReviewers = null;
    public ?string $csvMembers = null;
    public array $availableFiles = [];
    public array $reviewersFromCsv = [];
    public array $reviewersManual = [];
    public array $membersFromCsv = [];
    public array $membersManual = [];
    public array $fileEntries = [];
    public array $missingReviewerFiles = [];
    public string $log = "Prêt.";
    public string $status = 'En attente';
    public bool $running = false;
    public string $manualReviewerFile = '';
    public string $manualReviewerNames = '';
    public string $manualMemberName = '';
    public string $cacName = '';
    public bool $reviewerListOpen = false;
    public bool $memberListOpen = false;
    public bool $activityCollapsed = true;
    public string $assignmentTab = 'reviewers';
    public string $activityTab = 'log';
    protected ReviewerPreparationService $reviewerService;
    protected MemberPreparationService $memberService;
    protected CsvAssignmentLoader $csvLoader;
    protected WorkspaceService $workspace;

    public function render()
    {
        return view('livewire.dashboard');
    }



    public function boot(
        ReviewerPreparationService $reviewerService,
        MemberPreparationService $memberService,
        CsvAssignmentLoader $csvLoader,
        WorkspaceService $workspace
    ): void {
        $this->reviewerService = $reviewerService;
        $this->memberService = $memberService;
        $this->csvLoader = $csvLoader;
        $this->workspace = $workspace;
    }
    public function getCanRunReviewersProperty(): bool
    {
        return ! $this->running
            && ! empty($this->folder)
            && $this->reviewerPackages() !== []
            && trim($this->cacName) !== '';
    }

    public function getCanRunMembersProperty(): bool
    {
        return ! $this->running
            && ! empty($this->folder)
            && $this->combinedMembers() !== []
            && trim($this->cacName) !== '';
    }

    public function getReviewerSummariesProperty(): array
    {
        $missingLookup = array_map('strtolower', $this->missingReviewerFiles);
        $grouped = [];

        $appendAssignment = static function (
            array &$group,
            string $reviewer,
            string $file,
            string $source,
            ?int $manualIndex,
            array $missingLookup
        ): void {
            $reviewerName = trim($reviewer);
            if ($reviewerName === '' || $file === '') {
                return;
            }

            $normalisedReviewer = strtolower($reviewerName);

            if (! isset($group[$normalisedReviewer])) {
                $group[$normalisedReviewer] = [
                    'name' => $reviewerName,
                    'files' => [],
                    'has_manual' => false,
                    'has_csv' => false,
                    'has_missing' => false,
                ];
            }

            $isMissing = in_array(strtolower($file), $missingLookup, true);

            $group[$normalisedReviewer]['files'][] = [
                'name' => $file,
                'missing' => $isMissing,
                'manual' => $source === 'manual',
                'manual_index' => $manualIndex,
                'source' => $source,
            ];

            if ($source === 'manual') {
                $group[$normalisedReviewer]['has_manual'] = true;
            }

            if ($source === 'csv') {
                $group[$normalisedReviewer]['has_csv'] = true;
            }

            if ($isMissing) {
                $group[$normalisedReviewer]['has_missing'] = true;
            }
        };

        foreach ($this->reviewersFromCsv as $assignment) {
            $file = trim((string) ($assignment['file'] ?? ''));

            $reviewers = collect($assignment['reviewers'] ?? [])
                ->map(fn ($name) => trim((string) $name))
                ->filter()
                ->values();

            if ($file === '' || $reviewers->isEmpty()) {
                continue;
            }

            foreach ($reviewers as $reviewer) {
                $appendAssignment($grouped, $reviewer, $file, 'csv', null, $missingLookup);
            }
        }

        foreach ($this->reviewersManual as $index => $assignment) {
            $file = trim((string) ($assignment['file'] ?? ''));

            $reviewers = collect($assignment['reviewers'] ?? [])
                ->map(fn ($name) => trim((string) $name))
                ->filter()
                ->values();

            if ($file === '' || $reviewers->isEmpty()) {
                continue;
            }

            foreach ($reviewers as $reviewer) {
                $appendAssignment($grouped, $reviewer, $file, 'manual', $index, $missingLookup);
            }
        }

        $summaries = array_values($grouped);

        usort($summaries, static fn ($a, $b) => strcasecmp($a['name'], $b['name']));

        foreach ($summaries as &$summary) {
            usort($summary['files'], static fn ($a, $b) => strcmp($a['name'], $b['name']));
        }
        unset($summary);

        return $summaries;
    }

    public function updatedAssignmentTab(string $value): void
    {
        $this->assignmentTab = $value;
    }

    public function pickFolder(): void
    {
        $this->appendLog('Sélection du dossier...');
        $selection = Dialog::new()->folders()->open();
        if (! $selection) {
            $this->appendLog('Sélection du dossier annulée.');
            return;
        }

        $this->folder = $selection;
        $this->appendLog("Dossier sélectionné: {$selection}");
        $this->refreshAvailableFiles();
    }

    public function pickReviewersCsv(): void
    {
        $this->appendLog('Sélection du CSV des rapporteurs...');
        $selection = Dialog::new()->filter('CSV files',  ['csv'])->open();

        if (! $selection) {
            $this->appendLog('Sélection du CSV des rapporteurs annulée.');
            return;
        }

        $this->csvReviewers = $selection;
        $this->appendLog("CSV des rapporteurs sélectionné: {$selection}");

        try {
            $this->reviewersFromCsv = $this->csvLoader->reviewers($selection);
            $this->appendLog('Attributions de rapporteurs importées.');
            $this->checkReviewerFileWarnings();
        } catch (\Throwable $e) {
            $this->appendLog('Échec de lecture du CSV des rapporteurs: '.$e->getMessage());
        }
    }

    public function pickMembersCsv(): void
    {
        $this->appendLog('Sélection du fichier des membres...');
        $selection = Dialog::new()->filter('CSV files',  ['csv'])->open();

        if (! $selection) {
            $this->appendLog('Sélection du fichier des membres annulée.');
            return;
        }

        $this->csvMembers = $selection;
        $this->appendLog("Fichier des membres sélectionné: {$selection}");

        try {
            $this->membersFromCsv = $this->csvLoader->members($selection);
            $this->appendLog('Membres importés.');
        } catch (\Throwable $e) {
            $this->appendLog('Échec de lecture du fichier des membres: '.$e->getMessage());
        }
    }

    public function addManualReviewer(): void
    {
        $file = trim($this->manualReviewerFile);
        $names = collect(preg_split('/[,;\n]/', $this->manualReviewerNames ?? ''))
            ->map(fn ($name) => trim((string) $name))
            ->filter()
            ->values()
            ->all();

        if ($file === '' || empty($names)) {
            $this->appendLog('Veuillez renseigner un fichier et au moins un rapporteur.');
            return;
        }

        $this->reviewersManual[] = [
            'file' => $file,
            'reviewers' => $names,
            'source' => 'manual',
        ];

        $this->manualReviewerFile = '';
        $this->manualReviewerNames = '';
        $this->appendLog("Attribution manuelle ajoutée pour {$file}.");

        if (Str::of($file)->lower()->endsWith('.pdf') && ! in_array($file, $this->availableFiles, true)) {
            $this->availableFiles[] = $file;
            sort($this->availableFiles);
        }

        $this->checkReviewerFileWarnings(false);
    }

    public function removeManualReviewer(int $index): void
    {
        if (! isset($this->reviewersManual[$index])) {
            return;
        }
        $removed = $this->reviewersManual[$index];
        unset($this->reviewersManual[$index]);
        $this->reviewersManual = array_values($this->reviewersManual);
        $this->appendLog("Attribution manuelle supprimée: {$removed['file']}");

        $this->checkReviewerFileWarnings(false);
    }

    public function addManualMember(): void
    {
        $name = trim($this->manualMemberName);
        if ($name === '') {
            $this->appendLog('Veuillez saisir un nom de membre.');
            return;
        }
        $this->membersManual[] = [
            'name' => $name,
            'source' => 'manual',
        ];
        $this->manualMemberName = '';
        $this->appendLog("Membre manuel ajouté: {$name}");
    }

    public function removeManualMember(int $index): void
    {
        if (! isset($this->membersManual[$index])) {
            return;
        }
        $removed = $this->membersManual[$index];
        unset($this->membersManual[$index]);
        $this->membersManual = array_values($this->membersManual);
        $this->appendLog("Membre manuel supprimé: {$removed['name']}");
    }

    public function toggleReviewerList(): void
    {
        $this->reviewerListOpen = ! $this->reviewerListOpen;
    }

    public function toggleMemberList(): void
    {
        $this->memberListOpen = ! $this->memberListOpen;
    }

    public function toggleActivity(): void
    {
        $this->activityCollapsed = ! $this->activityCollapsed;
    }

    public function setAssignmentTab(string $tab): void
    {
        $this->assignmentTab = $tab;
    }

    public function setActivityTab(string $tab): void
    {
        $this->activityTab = $tab;
    }

    public function runReviewers(): void
    {
        $this->executeRun('reviewers');
    }

    public function runMembers(): void
    {
        $this->executeRun('members');
    }

    protected function executeRun(string $mode): void
    {
        if ($this->running) {
            return;
        }

        $this->log = '';
        $this->appendLog('Initialisation du pipeline...');

        try {
            if (! $this->folder || ! is_dir($this->folder)) {
                throw new RuntimeException('Veuillez d\'abord sélectionner un dossier.');
            }

            $collectionName = trim($this->cacName);

            if ($collectionName === '') {
                throw new RuntimeException('Veuillez saisir le nom du CAC.');
            }

            if ($mode === 'reviewers') {
                if ($this->reviewerPackages() === []) {
                    throw new RuntimeException('Aucune attribution de rapporteur disponible.');
                }
            } else {
                if ($this->combinedMembers() === []) {
                    throw new RuntimeException('Aucun membre disponible.');
                }
            }

            $this->running = true;
            $this->status = 'En cours...';

            $logger = function (string $message): void {
                $this->appendLog($message);
            };

            if ($mode === 'reviewers') {
                $packages = $this->reviewerPackages();
                $outputDir = $this->workspace->resolveOutputPath($this->folder, 'rapporteurs');

                $this->appendLog('Préparation des packages rapporteurs...');
                $this->reviewerService->prepare($packages, $this->folder, $outputDir, $collectionName, $logger);
            } else {
                $entries = $this->combinedMembers();
                $outputDir = $this->workspace->resolveOutputPath($this->folder, 'membres');

                $this->appendLog('Préparation des packages membres...');
                $this->memberService->prepare($entries, $this->folder, $outputDir, $collectionName, $logger);
            }

            $this->status = 'Terminé';
            $this->appendLog('Pipeline terminé avec succès.');
        } catch (\Throwable $e) {
            $this->status = 'Erreur';
            $this->appendLog('Erreur: '.$e->getMessage());
        } finally {
            $this->running = false;
        }
    }

    protected function refreshAvailableFiles(): void
    {
        $inventory = $this->workspace->inventory($this->folder);
        $this->availableFiles = collect($inventory['files'])
            ->filter(fn ($file) => Str::of($file)->lower()->endsWith('.pdf'))
            ->values()
            ->all();

        $this->fileEntries = collect($inventory['entries'])
            ->filter(fn ($entry) => ($entry['type'] ?? null) === 'file'
                && Str::of($entry['name'] ?? '')->lower()->endsWith('.pdf'))
            ->values()
            ->all();

        if ($this->reviewersFromCsv !== [] || $this->reviewersManual !== []) {
            $this->checkReviewerFileWarnings(false);
        }
    }

    protected function reviewerPackages(): array
    {
        return collect($this->reviewerSummaries)
            ->map(function ($summary) {
                $name = trim((string) ($summary['name'] ?? ''));

                $files = collect($summary['files'] ?? [])
                    ->pluck('name')
                    ->map(fn ($file) => trim((string) $file))
                    ->filter()
                    ->unique()
                    ->values()
                    ->all();

                if ($name === '' || $files === []) {
                    return null;
                }

                return [
                    'name' => $name,
                    'files' => $files,
                ];
            })
            ->filter()
            ->values()
            ->all();
    }

    protected function combinedMembers(): array
    {
        return collect(array_merge($this->membersFromCsv, $this->membersManual))
            ->filter(fn ($entry) => trim((string) ($entry['name'] ?? '')) !== '')
            ->unique('name')
            ->values()
            ->all();
    }

    protected function appendLog(string $message): void
    {
        $this->log = trim($this->log."\n".$message);
    }

    protected function checkReviewerFileWarnings(bool $shouldLog = true): void
    {
        $assignments = array_merge($this->reviewersFromCsv, $this->reviewersManual);
        $missing = $this->workspace->findMissingFiles($assignments, $this->availableFiles);

        if ($shouldLog) {
            foreach ($missing as $file) {
                $this->appendLog("⚠️ Fichier introuvable dans le dossier: {$file}");
            }
        }

        $this->missingReviewerFiles = $missing;
    }
}
