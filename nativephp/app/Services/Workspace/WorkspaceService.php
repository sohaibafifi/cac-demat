<?php

namespace App\Services\Workspace;
use Illuminate\Support\Facades\File;
use RuntimeException;

class WorkspaceService
{
    /**
     * Build an inventory of files and directories present in the target folder.
     *
     * @return array{files: array<int, string>, entries: array<int, array{name: string, type: string}>}
     */
    public function inventory(?string $folder): array
    {
        $availableFiles = [];
        $entries = [];

        if (! $folder) {
            return ['files' => $availableFiles, 'entries' => $entries];
        }

        $resolved = realpath($folder);
        if ($resolved === false || ! is_dir($resolved)) {
            return ['files' => $availableFiles, 'entries' => $entries];
        }

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($resolved, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::SELF_FIRST
        );

        foreach ($iterator as $item) {
            $relative = ltrim(str_replace(DIRECTORY_SEPARATOR, '/', $iterator->getSubPathName()), '/');
            if ($relative === '') {
                continue;
            }

            $type = $item->isDir() ? 'directory' : ($item->isFile() ? 'file' : 'other');

            $entries[] = [
                'name' => $relative,
                'type' => $type,
            ];

            if ($type === 'file') {
                $availableFiles[] = $relative;
            }
        }

        sort($availableFiles);
        usort($entries, static fn ($a, $b) => strcmp($a['name'], $b['name']));

        return ['files' => $availableFiles, 'entries' => $entries];
    }

    /**
     * Resolve and ensure the existence of a sub directory where generated files will be stored.
     */
    public function resolveOutputPath(?string $folder, string $directory): string
    {
        if (! $folder) {
            throw new RuntimeException('Dossier non défini.');
        }

        $base = realpath(dirname($folder));
        if ($base === false) {
            throw new RuntimeException('Impossible de déterminer le dossier de sortie.');
        }

        $target = $base.'/'.$directory;
        if (! is_dir($target)) {
            File::makeDirectory($target, 0755, true, true);
        }

        return $target;
    }

    /**
     * @param  array<int, array{file?: string}>  $assignments
     * @param  array<int, string>  $availableFiles
     * @return array<int, string>
     */
    public function findMissingFiles(array $assignments, array $availableFiles): array
    {
        if ($assignments === [] || $availableFiles === []) {
            return [];
        }

        $known = array_map('strtolower', $availableFiles);
        $missing = [];

        foreach ($assignments as $assignment) {
            $file = trim((string) ($assignment['file'] ?? ''));
            if ($file === '') {
                continue;
            }

            if (! in_array(strtolower($file), $known, true)) {
                $missing[] = $file;
            }
        }

        return array_values(array_unique($missing));
    }
}

