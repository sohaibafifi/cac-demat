<?php

namespace App\Services\Pipeline;

use App\Services\Pdf\PdfPackageProcessor;
use Illuminate\Support\Facades\File;
use RuntimeException;

class ReviewerPreparationService
{
    public function __construct(
        protected PdfPackageProcessor $packageProcessor
    ) {
    }

    /**
     * @param array<int, array{name: string, files: array<int, string>}> $packages
     */
    public function prepare(array $packages, string $sourceDir, string $outputDir, string $collectionName, ?callable $logger = null): void
    {
        $resolvedSourceDir = realpath($sourceDir);
        if ($resolvedSourceDir === false || ! is_dir($resolvedSourceDir)) {
            throw new RuntimeException(sprintf('Dossier source introuvable: %s', $sourceDir));
        }

        File::makeDirectory($outputDir, 0755, true, true);

        $inventory = $this->packageProcessor->collectPdfFiles($resolvedSourceDir);

        $normalisedPackages = [];
        foreach ($packages as $package) {
            $name = trim((string) ($package['name'] ?? ''));
            if ($name === '') {
                continue;
            }

            $files = array_map(static fn ($file) => trim((string) $file), $package['files'] ?? []);
            $files = array_values(array_filter($files, static fn ($file) => $file !== ''));

            if ($files === []) {
                continue;
            }

            $normalisedPackages[] = [
                'name' => $name,
                'files' => $files,
            ];
        }

        if ($normalisedPackages === []) {
            return;
        }

        $this->packageProcessor->prepare(
            $normalisedPackages,
            $resolvedSourceDir,
            $outputDir,
            'reviewer',
            $collectionName,
            $logger,
            $inventory,
            function (array $file, string $recipient, bool $restricted, ?string $password) use ($logger): void {
                $this->log($logger, sprintf('Processed %s for %s (owner password: %s)', $file['relative'], $recipient, $password));
            }
        );
    }

    protected function log(?callable $logger, string $message): void
    {
        if ($logger) {
            $logger($message);
        }
    }

}
