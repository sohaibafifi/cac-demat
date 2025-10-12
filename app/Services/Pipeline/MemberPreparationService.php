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

    public function prepare(array $members, string $sourceDir, string $outputDir, ?callable $logger = null): void
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

        $relativeFiles = array_map(static fn ($file) => $file['relative'], $inventory);

        $packages = [];
        foreach ($members as $entry) {
            $name = trim((string) ($entry['name'] ?? ''));
            if ($name === '') {
                continue;
            }

            $packages[] = [
                'name' => $name,
                'files' => $relativeFiles,
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
            $logger,
            $inventory
        );
    }
}
