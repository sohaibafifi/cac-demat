<?php

namespace App\Services\Pipeline;

use App\Support\Text\NameSanitizer;
use Illuminate\Support\Facades\File;

class PdfPackageProcessor
{
    public function __construct(
        protected PdfProcessingPipeline $pipeline
    ) {
    }

    /**
     * @param array<int, array{name: string, files: array<int, string>}> $packages
     * @param array<int, array{path: string, relative: string, relative_dir: string, basename: string}>|null $inventory
     */
    public function prepare(
        array $packages,
        string $resolvedSourceDir,
        string $outputDir,
        string $sanitizeContext,
        ?callable $logger = null,
        ?array $inventory = null,
        ?callable $afterFileProcessed = null
    ): void {
        $inventory = $inventory ?? $this->collectPdfFiles($resolvedSourceDir);
        $lookup = [];
        foreach ($inventory as $entry) {
            $lookup[strtolower($entry['relative'])] = $entry;
        }

        foreach ($packages as $package) {
            $name = trim((string) ($package['name'] ?? ''));
            if ($name === '') {
                continue;
            }

            $folderName = NameSanitizer::sanitize($name, $sanitizeContext);
            $recipientDir = $outputDir.'/'.$folderName;
            File::makeDirectory($recipientDir, 0755, true, true);

            $files = array_map(static fn ($file) => trim((string) $file), $package['files'] ?? []);
            $files = array_values(array_filter($files, static fn ($file) => $file !== ''));

            if ($files === []) {
                continue;
            }

            $useDefaultLogging = $afterFileProcessed === null;

            foreach ($files as $relative) {
                $key = strtolower($relative);
                if (! isset($lookup[$key])) {
                    $this->log($logger, sprintf('Warning: Source file %s not found. Skipping for %s.', $relative, $name));
                    continue;
                }

                $file = $lookup[$key];
                $destinationDir = $file['relative_dir'] === '' ? $recipientDir : $recipientDir.'/'.$file['relative_dir'];
                File::makeDirectory($destinationDir, 0755, true, true);

                $context = new PdfProcessingContext(
                    workingPath: $file['path'],
                    relativePath: $file['relative'],
                    recipient: $name,
                    targetDirectory: $destinationDir,
                    basename: $file['basename'],
                    useDefaultLogging: $useDefaultLogging,
                );

                $result = $this->pipeline->process($context, $logger);

                if ($afterFileProcessed) {
                    $afterFileProcessed($file, $name, true, $result->password);
                } elseif (! $useDefaultLogging && $result->password !== null) {
                    $this->log($logger, sprintf(
                        'Processed %s for %s (owner password: %s)',
                        $file['relative'],
                        $name,
                        $result->password
                    ));
                }
            }
        }
    }

    /**
     * @return array<int, array{path: string, relative: string, relative_dir: string, basename: string}>
     */
    public function collectPdfFiles(string $resolvedSourceDir): array
    {
        $files = [];
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($resolvedSourceDir, \FilesystemIterator::SKIP_DOTS)
        );

        foreach ($iterator as $item) {
            if (! $item->isFile()) {
                continue;
            }

            if (strtolower($item->getExtension()) !== 'pdf') {
                continue;
            }

            $relativePath = ltrim(str_replace(DIRECTORY_SEPARATOR, '/', substr($item->getPathname(), strlen($resolvedSourceDir))), '/');
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
}
