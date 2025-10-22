<?php

namespace App\Services\Pipeline;

use App\Services\Pdf\PdfPackageProcessor;
use Illuminate\Support\Facades\File;
use RuntimeException;

class MemberPreparationService
{
    public function __construct(
        protected PdfPackageProcessor $packageProcessor
    ) {
    }

    public function prepare(array $members, string $sourceDir, string $outputDir, string $collectionName, ?callable $logger = null): void
    {
        $resolvedSourceDir = realpath($sourceDir);
        if ($resolvedSourceDir === false || ! is_dir($resolvedSourceDir)) {
            throw new RuntimeException(sprintf('Dossier source introuvable: %s', $sourceDir));
        }

        File::makeDirectory($outputDir, 0755, true, true);

        $inventory = $this->packageProcessor->collectPdfFiles($resolvedSourceDir);
        if ($inventory === []) {
            throw new RuntimeException(sprintf('Aucun fichier PDF trouvé dans %s.', $sourceDir));
        }

        $packages = [];
        foreach ($members as $entry) {
            $name = trim((string) ($entry['name'] ?? ''));
            if ($name === '') {
                continue;
            }

            $requested = array_map(
                static fn ($value) => trim((string) $value),
                $entry['files'] ?? []
            );
            $requested = array_values(array_filter($requested, static fn ($value) => $value !== ''));

            if ($requested === []) {
                $files = array_map(static fn ($file) => $file['relative'], $inventory);
            } else {
                $files = $this->resolveRequestedFiles($requested, $inventory, $logger);
            }

            if ($files === []) {
                $this->log($logger, sprintf('Aucun fichier attribué pour le membre %s. Attribution ignorée.', $name));
                continue;
            }

            $packages[] = [
                'name' => $name,
                'files' => $files,
            ];
        }

        if ($packages === []) {
            return;
        }

        $this->packageProcessor->prepare(
            $packages,
            $resolvedSourceDir,
            $outputDir,
            'member',
            $collectionName,
            $logger,
            $inventory
        );
    }

    /**
     * @param array<int, string> $requested
     * @param array<int, array{path: string, relative: string, relative_dir: string, basename: string}> $inventory
     * @return array<int, string>
     */
    protected function resolveRequestedFiles(array $requested, array $inventory, ?callable $logger = null): array
    {
        $lookup = [];
        $indexed = [];

        foreach ($inventory as $entry) {
            $lower = strtolower($entry['relative']);
            $lookup[$lower] = $entry['relative'];
            $indexed[] = [
                'relative' => $entry['relative'],
                'lower' => $lower,
            ];
        }

        $resolved = [];

        foreach ($requested as $rawPath) {
            $normalised = $this->normaliseRequestedPath($rawPath);
            if ($normalised === '') {
                continue;
            }

            $lower = strtolower($normalised);

            if (isset($lookup[$lower])) {
                $resolved[] = $lookup[$lower];
                continue;
            }

            $folderMatches = [];
            $folderCandidate = rtrim($lower, '/');

            if ($folderCandidate !== '') {
                $prefix = $folderCandidate.'/';

                foreach ($indexed as $item) {
                    if (str_starts_with($item['lower'], $prefix)) {
                        $folderMatches[] = $item['relative'];
                    }
                }
            }

            if ($folderMatches !== []) {
                $resolved = array_merge($resolved, $folderMatches);
                continue;
            }

            $this->log($logger, sprintf('Affectation CSV: aucun fichier ou dossier ne correspond à "%s".', $rawPath));
        }

        $resolved = array_values(array_unique($resolved));
        sort($resolved);

        return $resolved;
    }

    protected function normaliseRequestedPath(string $path): string
    {
        $normalised = trim($path);
        if ($normalised === '') {
            return '';
        }

        $normalised = str_replace('\\', '/', $normalised);
        $normalised = preg_replace('#/+#', '/', $normalised) ?? $normalised;
        $normalised = preg_replace('#^\./+#', '', $normalised) ?? $normalised;
        $normalised = ltrim($normalised, '/');

        return $normalised;
    }

    protected function log(?callable $logger, string $message): void
    {
        if ($logger) {
            $logger($message);
        }
    }
}
