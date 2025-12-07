<?php

namespace App\Services\Assignments;

use Illuminate\Support\Str;

class PdfFileMatcher
{
    /**
     * @var array<int, array{original: string, normalized: string}>
     */
    protected array $candidates;

    /**
     * @param  array<int, string>  $files
     */
    public function __construct(array $files)
    {
        $this->candidates = collect($files)
            ->filter(fn ($file) => Str::of((string) $file)->lower()->endsWith('.pdf'))
            ->map(fn ($file) => [
                'original' => (string) $file,
                'normalized' => $this->normalizeCandidateToken(pathinfo((string) $file, PATHINFO_FILENAME)),
            ])
            ->filter(fn ($candidate) => $candidate['normalized'] !== '')
            ->values()
            ->all();
    }

    public static function looksLikeNameReference(string $value): bool
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return false;
        }

        if (! str_contains($trimmed, ' ')) {
            return false;
        }

        if (strpbrk($trimmed, '\\/*?.') !== false) {
            return false;
        }

        return true;
    }

    public function findBestMatch(string $firstName, string $lastName): ?string
    {
        $first = $this->normalizeNameToken($firstName);
        $last = $this->normalizeNameToken($lastName);

        if ($first === '' && $last === '') {
            return null;
        }

        $bestScore = 0;
        $bestMatch = null;

        foreach ($this->candidates as $candidate) {
            $score = $this->scoreCandidate($candidate['normalized'], $first, $last);
            if ($score === 0) {
                continue;
            }

            if ($score > $bestScore || ($score === $bestScore && $bestMatch !== null && $this->isBetterCandidate($candidate['original'], $bestMatch))) {
                $bestScore = $score;
                $bestMatch = $candidate['original'];
            } elseif ($bestMatch === null) {
                $bestScore = $score;
                $bestMatch = $candidate['original'];
            }
        }

        return $bestMatch;
    }

    public function findByNameReference(string $reference): ?string
    {
        $normalized = trim(preg_replace('/\s+/', ' ', $reference) ?? '');
        if ($normalized === '') {
            return null;
        }

        $parts = explode(' ', $normalized, 2);

        if (count($parts) === 1) {
            return $this->findBestMatch($parts[0], '') ?? $this->findBestMatch('', $parts[0]);
        }

        [$first, $second] = $parts;

        return $this->findBestMatch($first, $second)
            ?? $this->findBestMatch($second, $first)
            ?? $this->findBestMatch($normalized, '');
    }

    private function scoreCandidate(string $candidate, string $firstName, string $lastName): int
    {
        $score = 0;
        $firstPattern = $firstName !== '' ? " {$firstName} " : '';
        $lastPattern = $lastName !== '' ? " {$lastName} " : '';
        $hasFirst = $firstPattern !== '' && str_contains($candidate, $firstPattern);
        $hasLast = $lastPattern !== '' && str_contains($candidate, $lastPattern);

        if (! $hasFirst && ! $hasLast) {
            return 0;
        }

        if ($firstPattern !== '' && $lastPattern !== '' && (! $hasFirst || ! $hasLast)) {
            return 0;
        }

        if ($hasLast) {
            $score += 20;
        }

        if ($hasFirst) {
            $score += 10;
        }

        if ($hasFirst && $hasLast) {
            $score += 100;
            $firstIndexRaw = strpos($candidate, $firstPattern);
            $lastIndexRaw = strpos($candidate, $lastPattern);
            $firstIndex = $firstIndexRaw === false ? -1 : $firstIndexRaw + 1;
            $lastIndex = $lastIndexRaw === false ? -1 : $lastIndexRaw + 1;

            if ($firstIndex >= 0 && $lastIndex >= 0) {
                $distance = abs($firstIndex - $lastIndex);

                if ($distance <= max(strlen($firstName), strlen($lastName))) {
                    $score += 5;
                } elseif ($distance <= max(1, (int) floor(strlen($candidate) / 2))) {
                    $score += 2;
                }

                if ($lastIndex <= $firstIndex) {
                    $score += 3;
                } else {
                    $score += 1;
                }
            }
        }

        return $score;
    }

    private function isBetterCandidate(string $candidate, string $current): bool
    {
        $candidateLength = strlen($candidate);
        $currentLength = strlen($current);

        if ($candidateLength !== $currentLength) {
            return $candidateLength < $currentLength;
        }

        return strcasecmp($candidate, $current) < 0;
    }

    private function normalizeNameToken(string $value): string
    {
        $value = trim($value);
        if ($value === '') {
            return '';
        }

        $value = $this->ascii($value);
        $value = Str::lower($value);

        return preg_replace('/[^a-z0-9]/', '', $value) ?? '';
    }

    private function normalizeCandidateToken(string $value): string
    {
        $value = trim($value);
        if ($value === '') {
            return '';
        }

        $value = $this->ascii($value);
        $value = Str::lower($value);
        $value = preg_replace('/[^a-z0-9]+/', ' ', $value) ?? '';
        $value = trim($value);

        return $value === '' ? '' : " {$value} ";
    }

    private function ascii(string $value): string
    {
        $transliterated = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);

        if ($transliterated === false) {
            return $value;
        }

        return $transliterated;
    }
}
