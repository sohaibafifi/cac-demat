<?php

namespace App\Services\Pipeline;
use App\Services\Pdf\PdfRestrictionService;
use App\Services\Pdf\WatermarkService;
use App\Support\Security\PasswordGenerator;
use App\Support\Text\NameSanitizer;
use Illuminate\Support\Facades\File;
use RuntimeException;

class MemberPreparationService
{
    public function __construct(
        protected WatermarkService $watermarkService,
        protected PdfRestrictionService $restrictionService,
        protected PasswordGenerator $passwordGenerator
    ) {
    }

    public function prepare(array $members, string $sourceDir, string $outputDir, bool $restrict = true, ?callable $logger = null): void
    {
        $resolvedSourceDir = realpath($sourceDir);
        if ($resolvedSourceDir === false || ! is_dir($resolvedSourceDir)) {
            throw new RuntimeException(sprintf('Dossier source introuvable: %s', $sourceDir));
        }

        File::makeDirectory($outputDir, 0755, true, true);

        $pdfFiles = $this->collectPdfFiles($resolvedSourceDir);
        if ($pdfFiles === []) {
            throw new RuntimeException(sprintf('Aucun fichier PDF trouvé dans %s.', $sourceDir));
        }

        foreach ($members as $entry) {
            $this->processMember($entry, $outputDir, $pdfFiles, $logger, $restrict);
        }
    }



    /**
     * @return array<int, array{path: string, relative: string, relative_dir: string, basename: string}>
     */
    protected function collectPdfFiles(string $sourceDir): array
    {
        $files = [];
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($sourceDir, \FilesystemIterator::SKIP_DOTS)
        );

        foreach ($iterator as $item) {
            if (! $item->isFile()) {
                continue;
            }

            if (strtolower($item->getExtension()) !== 'pdf') {
                continue;
            }

            $relativePath = ltrim(str_replace(DIRECTORY_SEPARATOR, '/', substr($item->getPathname(), strlen($sourceDir))), '/');
            $files[] = [
                'path' => $item->getPathname(),
                'relative' => $relativePath,
                'relative_dir' => trim(str_replace('\\', '/', dirname($relativePath)), '/'),
                'basename' => $item->getBasename(),
            ];
        }

        usort($files, static fn ($a, $b) => strcmp($a['relative'], $b['relative']));

        return $files;
    }
    protected function log(?callable $logger, string $message): void
    {
        if ($logger) {
            $logger($message);
        }
    }

    /**
     * @param array $entry
     * @param string $outputDir
     * @param array $pdfFiles
     * @param callable|null $logger
     * @param bool $restrict
     * @return void
     */
    public function processMember(array $entry, string $outputDir, array $pdfFiles, ?callable $logger, bool $restrict): void
    {
        $name = trim((string) ($entry['name'] ?? ''));
        if ($name === '') {
            return;
        }
        $folderName = NameSanitizer::sanitize($name, 'member');
        $memberDir = $outputDir . '/' . $folderName;
        File::makeDirectory($memberDir, 0755, true, true);

        foreach ($pdfFiles as $file) {
            $destinationDir = $file['relative_dir'] === '' ? $memberDir : $memberDir . '/' . $file['relative_dir'];
            File::makeDirectory($destinationDir, 0755, true, true);

            $watermarkedPath = $destinationDir . '/watermarked_' . $file['basename'];
            $finalPath = $destinationDir . '/' . $file['basename'];

            $this->watermarkService->applyWatermark($file['path'], $watermarkedPath, $name);
            $this->log($logger, sprintf('  → %s: watermark %s applied', $file['relative'], $name));

            if ($restrict) {
                $password = $this->passwordGenerator->generate(12);

                $this->restrictionService->restrict($watermarkedPath, $finalPath, $password, $logger);
                @unlink($watermarkedPath);
                $this->log($logger, sprintf('  → %s: restricted (owner password: %s)', $file['relative'], $password));
            } else {
                File::move($watermarkedPath, $finalPath);
                $this->log($logger, sprintf('  → %s: watermark applied without restrictions', $file['relative']));
            }
        }
    }
}
