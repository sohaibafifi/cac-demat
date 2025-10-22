<?php

namespace App\Services\Assignments;

use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use League\Csv\Exception;
use League\Csv\Reader;
use League\Csv\SyntaxError;
use League\Csv\UnavailableStream;
use RuntimeException;

class CsvAssignmentLoader
{
    /**
     * @return array<int, array{file: string, reviewers: array<int, string>, source: string}>
     */
    public function reviewers(string $path): array
    {
        $table = $this->readCsv($path);
        $headers = collect($table['headers']);

        $fileHeader = $headers
            ->first(fn ($header) => Str::lower((string) $header) === 'file')
            ?? ($headers->first() ?? 'file');

        $assignments = [];

        foreach ($table['records'] as $row) {
            $file = trim((string) ($row[$fileHeader] ?? ''));
            if ($file === '') {
                continue;
            }

            $reviewers = [];
            foreach ($row as $key => $value) {
                if (Str::startsWith(Str::lower((string) $key), 'reviewer')) {
                    $candidate = trim((string) $value);
                    if ($candidate !== '') {
                        $reviewers[] = $candidate;
                    }
                }
            }

            if ($reviewers === []) {
                continue;
            }

            $assignments[] = [
                'file' => $file,
                'reviewers' => $reviewers,
                'source' => 'csv',
            ];
        }

        return $assignments;
    }

    /**
     * @param string $path
     * @return array<int, array{name: string, source: string, files: array<int, string>}>
     * @throws Exception
     * @throws SyntaxError
     * @throws UnavailableStream
     */
    public function members(string $path): array
    {
        $table = $this->readCsv($path);

        $headers = collect($table['headers'])
            ->map(fn ($header) => trim((string) $header))
            ->filter()
            ->values();

        $memberHeader = $headers
            ->first(function ($header) {
                $normalized = Str::lower((string) $header);
                return in_array($normalized, ['member', 'membre'], true);
            });

        if ($memberHeader !== null) {
            $assignments = [];

            foreach ($table['records'] as $row) {
                $memberName = trim((string) ($row[$memberHeader] ?? ''));

                if ($memberName === '') {
                    continue;
                }

                $paths = collect($row)
                    ->except($memberHeader)
                    ->flatMap(function ($value) {
                        return collect(preg_split('/[;\r\n]/', (string) $value) ?: [])
                            ->map(fn ($candidate) => trim((string) $candidate))
                            ->filter();
                    })
                    ->values()
                    ->all();

                $key = Str::lower($memberName);

                if (! isset($assignments[$key])) {
                    $assignments[$key] = [
                        'name' => $memberName,
                        'files' => [],
                        'source' => 'csv',
                    ];
                }

                if ($paths !== []) {
                    $assignments[$key]['files'] = array_values(array_unique(array_merge(
                        $assignments[$key]['files'],
                        $paths
                    )));
                }
            }

            return array_values($assignments);
        }

        $names = $headers->values();

        foreach ($table['records'] as $row) {
            foreach ($row as $value) {
                $member = trim((string) $value);
                if ($member !== '') {
                    $names->push($member);
                }
            }
        }

        return $names
            ->unique()
            ->map(fn ($name) => [
                'name' => $name,
                'files' => [],
                'source' => 'csv',
            ])
            ->values()
            ->all();
    }

    /**
     * @param string $path
     * @return array{headers: Collection<int, string>, records: array<int, array<string, string>>}
     * @throws Exception
     * @throws SyntaxError
     * @throws UnavailableStream
     */
    protected function readCsv(string $path): array
    {
        if (! is_file($path)) {
            throw new RuntimeException(sprintf('Impossible de trouver le fichier CSV: %s', $path));
        }

        $reader = Reader::createFromPath($path, 'r');
        $reader->setHeaderOffset(0);

        return [
            'headers' => collect($reader->getHeader()),
            'records' => iterator_to_array($reader->getRecords(), false),
        ];
    }
}
