<?php

namespace App\Services\Pipeline;

use App\Services\Pdf\PdfRestrictionService;
use App\Services\Pdf\QpdfCommandResolver;
use App\Services\Pdf\WatermarkService;
use App\Support\Security\PasswordGenerator;
use App\Support\Text\NameSanitizer;
use RuntimeException;
use Illuminate\Support\Facades\File;

class ReviewerPreparationService
{
    public function __construct(
        protected QpdfCommandResolver $commandResolver,
        protected WatermarkService $watermarkService,
        protected PdfRestrictionService $restrictionService,
        protected PasswordGenerator $passwordGenerator
    ) {
    }

    public function prepare(array $assignments, string $sourceDir, string $outputDir, bool $restrict = true, ?callable $logger = null): void
    {
        $command = $this->commandResolver->resolve();
        $this->log($logger, sprintf('[qpdf] Using command: %s', $command));

        $resolvedSourceDir = realpath($sourceDir);
        if ($resolvedSourceDir === false || ! is_dir($resolvedSourceDir)) {
            throw new RuntimeException(sprintf('Dossier source introuvable: %s', $sourceDir));
        }

        File::makeDirectory($outputDir, 0755, true, true);

        foreach ($assignments as $assignment) {
            $file = trim((string) ($assignment['file'] ?? ''));
            if ($file === '') {
                continue;
            }

            $reviewers = collect($assignment['reviewers'] ?? [])
                ->map(fn ($name) => trim((string) $name))
                ->filter()
                ->values();

            if ($reviewers->isEmpty()) {
                continue;
            }

            $sourcePath = $this->joinPath($resolvedSourceDir, $file);
            if (! is_file($sourcePath)) {
                $message = sprintf('Warning: Source file %s not found. Skipping.', $sourcePath);
                $this->log($logger, $message);
                continue;
            }

            foreach ($reviewers as $reviewer) {
                $this->processReviewer($reviewer, $file, $sourcePath, $outputDir, $restrict, $logger);
            }
        }
    }

    protected function processReviewer(string $reviewer, string $relativeFile, string $sourcePath, string $outputDir, bool $restrict, ?callable $logger): void
    {
        $folderName = NameSanitizer::sanitize($reviewer, 'reviewer');
        $reviewerDir = $outputDir.'/'.$folderName;
        File::makeDirectory($reviewerDir, 0755, true, true);

        $relativeDir = trim(str_replace('\\', '/', dirname($relativeFile)), '/');
        $targetDir = $relativeDir === '' ? $reviewerDir : $reviewerDir.'/'.$relativeDir;
        File::makeDirectory($targetDir, 0755, true, true);

        $baseName = basename($relativeFile);
        $watermarkedPath = $targetDir.'/watermarked_'.$baseName;
        $finalPath = $targetDir.'/'.$baseName;

        $this->watermarkService->applyWatermark($sourcePath, $watermarkedPath, $reviewer);

        if ($restrict) {
            $password = $this->passwordGenerator->generate(12);
            $this->restrictionService->restrict($watermarkedPath, $finalPath, $password, $logger);
            @unlink($watermarkedPath);
            $this->log($logger, sprintf('Processed %s for %s (owner password: %s)', $relativeFile, $reviewer, $password));
        } else {
            File::move($watermarkedPath, $finalPath);
            $this->log($logger, sprintf('Processed %s for %s without restrictions.', $relativeFile, $reviewer));
        }
    }

    protected function joinPath(string $base, string $relative): string
    {
        $normalised = str_replace('\\', '/', $relative);
        return rtrim($base, '/').'/'.ltrim($normalised, '/');
    }

    protected function log(?callable $logger, string $message): void
    {
        if ($logger) {
            $logger($message);
        }
    }


}
