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

    /**
     * @return array{requested_recipients: int, processed_recipients: int, processed_files: int, missing_files: array<int, string>}
     */
    public function prepare(array $members, string $sourceDir, string $outputDir, string $collectionName, ?callable $logger = null): array
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
            return [
                'requested_recipients' => 0,
                'processed_recipients' => 0,
                'processed_files' => 0,
                'missing_files' => [],
            ];
        }

        return $this->packageProcessor->prepare(
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
        $rootLevel = [];

        foreach ($inventory as $entry) {
            $relative = $entry['relative'];
            $lower = strtolower($relative);
            $lookup[$lower] = $relative;
            $indexed[] = [
                'relative' => $relative,
                'lower' => $lower,
            ];

            if (! str_contains($relative, '/')) {
                $rootLevel[] = $relative;
            }
        }

        $resolved = [];

        foreach ($requested as $rawPath) {
            $trimmed = trim((string) $rawPath);
            if ($trimmed === '') {
                continue;
            }

            if ($trimmed === '.') {
                $resolved = array_merge($resolved, $rootLevel);
                continue;
            }

            if (str_contains($trimmed, '*')) {
                $matches = $this->matchWildcardEntries($trimmed, $inventory);
                if ($matches === []) {
                    $this->log($logger, sprintf('Aucun fichier correspondant au motif: %s', $trimmed));
                } else {
                    $resolved = array_merge($resolved, $matches);
                }
                continue;
            }

            $normalised = $this->normaliseRequestedPath($trimmed);
            if ($normalised === '') {
                continue;
            }

            $lower = strtolower($normalised);

            if (isset($lookup[$lower])) {
                $resolved[] = $lookup[$lower];
                continue;
            }

            $folderMatches = $this->matchFolderEntries($normalised, $indexed);

            if ($folderMatches !== []) {
                $resolved = array_merge($resolved, $folderMatches);
                continue;
            }

            $this->log($logger, sprintf('Fichier introuvable: %s', $trimmed));
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

    /**
     * @param array<int, array{relative: string, lower: string}> $indexed
     * @return array<int, string>
     */
    protected function matchFolderEntries(string $folder, array $indexed): array
    {
        $normalised = rtrim($this->normaliseRequestedPath($folder), '/');
        if ($normalised === '') {
            return [];
        }

        $prefix = strtolower($normalised).'/';
        $matches = [];

        foreach ($indexed as $item) {
            if (str_starts_with($item['lower'], $prefix)) {
                $matches[] = $item['relative'];
            }
        }

        return $matches;
    }

    /**
     * @param array<int, array{path: string, relative: string, relative_dir: string, basename: string}> $inventory
     * @return array<int, string>
     */
    protected function matchWildcardEntries(string $pattern, array $inventory): array
    {
        $pattern = trim($pattern);
        if ($pattern === '') {
            return [];
        }

        $normalised = str_replace('\\', '/', $pattern);
        $escaped = preg_quote($normalised, '#');
        $regex = '#^'.str_replace('\*', '.*', $escaped).'$#i';

        $matches = [];

        foreach ($inventory as $entry) {
            if (preg_match($regex, $entry['relative'])) {
                $matches[] = $entry['relative'];
            }
        }

        return $matches;
    }

    protected function log(?callable $logger, string $message): void
    {
        if ($logger) {
            $logger($message);
        }
    }
}
