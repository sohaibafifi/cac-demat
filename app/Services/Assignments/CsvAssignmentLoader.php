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
     * @return array<int, array{name: string, source: string}>
     * @throws Exception
     * @throws SyntaxError
     * @throws UnavailableStream
     */
    public function members(string $path): array
    {
        $table = $this->readCsv($path);

        $names = collect($table['headers'])
            ->map(fn ($header) => trim((string) $header))
            ->filter()
            ->values();

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
