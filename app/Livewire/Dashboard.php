<?php

namespace App\Livewire;

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
    public string $log = "Prêt.";
    public string $status = 'En attente';
    public bool $running = false;
    public string $manualReviewerFile = '';
    public string $manualReviewerNames = '';
    public string $manualMemberName = '';
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
            && $this->combinedReviewers() !== [];
    }

    public function getCanRunMembersProperty(): bool
    {
        return ! $this->running
            && ! empty($this->folder)
            && $this->combinedMembers() !== [];
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

            if ($mode === 'reviewers') {
                if ($this->combinedReviewers() === []) {
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
                $assignments = $this->combinedReviewers();
                $outputDir = $this->workspace->resolveOutputPath($this->folder, 'reviewers_output');

                $this->appendLog('Préparation des packages rapporteurs...');
                $this->reviewerService->prepare($assignments, $this->folder, $outputDir, true, $logger);
            } else {
                $entries = $this->combinedMembers();
                $outputDir = $this->workspace->resolveOutputPath($this->folder, 'members_output');

                $this->appendLog('Préparation des packages membres...');
                $this->memberService->prepare($entries, $this->folder, $outputDir, true, $logger);
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
    }

    protected function combinedReviewers(): array
    {
        return collect(array_merge($this->reviewersFromCsv, $this->reviewersManual))
            ->filter(fn ($assignment) => isset($assignment['file'], $assignment['reviewers']) &&
                trim((string) $assignment['file']) !== '' &&
                collect($assignment['reviewers'])->filter(fn ($name) => trim((string) $name) !== '')->isNotEmpty())
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

    protected function checkReviewerFileWarnings(): void
    {
        $missing = $this->workspace->findMissingFiles($this->reviewersFromCsv, $this->availableFiles);

        foreach ($missing as $file) {
            $this->appendLog("⚠️ Fichier introuvable dans le dossier: {$file}");
        }
    }
}
