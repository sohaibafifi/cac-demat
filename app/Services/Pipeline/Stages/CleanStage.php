<?php

namespace App\Services\Pipeline\Stages;

use App\Services\Pdf\QpdfCommandResolver;
use App\Services\Pipeline\Contracts\PdfProcessingStage;
use App\Services\Pipeline\PdfProcessingContext;
use Illuminate\Support\Str;
use RuntimeException;
use Symfony\Component\Process\Process;

class CleanStage implements PdfProcessingStage
{
    protected string $pattern = '/\\b\\d{2}[ -]?[GPAEBSNIKT][ -]?\\d{2}[ -]?\\d{5}[ -]?[A-Z]{3}\\b/';
    protected string $splitPattern = '/(\(\s*\d{2}\s*\))(-?\d+(?:\.\d+)?)(\(\s*[GPAEBSNIKT]\s*\))'
    .'(-?\d+(?:\.\d+)?)(\(\s*\d{2}\s*\))(-?\d+(?:\.\d+)?)(\(\s*\d{5}\s*\))'
    .'(-?\d+(?:\.\d+)?)(\(\s*[A-Z]{3}\s*\))/';

    public function __construct(
        protected QpdfCommandResolver $commandResolver
    ) {
    }

    public function process(PdfProcessingContext $context, ?callable $logger = null): PdfProcessingContext
    {
        $qdfPath = $this->convertToQdf($context->workingPath);

        if (! $this->sanitizeQdf($qdfPath, $logger)) {
            @unlink($qdfPath);
            return $context;
        }

        $context = $context->withWorkingPath($qdfPath);
        $rebuiltPath = $this->rebuildPdf($qdfPath);

        if ($context->useDefaultLogging) {
            $this->log($logger, sprintf('  → %s: nettoyage des informations sensibles appliqué', $context->relativePath));
        }

        return $context->withWorkingPath($rebuiltPath, temporary: false);
    }

    protected function convertToQdf(string $sourcePath): string
    {
        $command = $this->commandResolver->resolve();
        $qdfPath = sys_get_temp_dir().'/cac_demat_qdf_'.Str::uuid().'.pdf';

        $process = new Process([
            $command,
            '--stream-data=uncompress',
            '--object-streams=disable',
            '--qdf',
            $sourcePath,
            $qdfPath,
        ]);
        $process->setTimeout(null);
        $process->run();

        $success = $process->isSuccessful() && file_exists($qdfPath);

        if (! $success) {
            if (file_exists($qdfPath)) {
                @unlink($qdfPath);
            }

            $error = trim($process->getErrorOutput() ?: $process->getOutput());

            throw new RuntimeException(sprintf(
                'Impossible de générer la version QDF du PDF. Commande: %s. Erreur: %s',
                $command,
                $error !== '' ? $error : 'inconnue'
            ));
        }

        return $qdfPath;
    }

    protected function sanitizeQdf(string $path, ?callable $logger = null): bool
    {
        $contents = file_get_contents($path);
        if ($contents === false) {
            throw new RuntimeException(sprintf('Impossible de lire le fichier QDF: %s', $path));
        }

        $count = 0;
        $sanitised = $this->maskContiguousMatches($contents, $count, $logger);

        if ($sanitised === null) {
            $this->log($logger, sprintf('    ⚠️ Motif de nettoyage désactivé (erreur PCRE: %d)', preg_last_error()));
            $this->pattern = '';

            return false;
        }

        $sanitised = $this->maskSplitMatches($sanitised, $count, $logger);

        if ($count === 0) {
            return false;
        }

        if (file_put_contents($path, $sanitised) === false) {
            throw new RuntimeException(sprintf('Impossible d\'écrire le fichier QDF nettoyé: %s', $path));
        }

        $this->log($logger, sprintf('    → %d occurrence(s) masquées', $count));

        return true;
    }

    protected function maskContiguousMatches(string $contents, int &$count, ?callable $logger): ?string
    {
        $result = @preg_replace_callback($this->pattern, function (array $hit) use (&$count, $logger) {
            $count++;
            $this->log($logger, sprintf('    → Séquence masquée: %s', $hit[0]));

            return str_repeat('X', strlen($hit[0]));
        }, $contents);

        return $result;
    }

    protected function maskSplitMatches(string $contents, int &$count, ?callable $logger): string
    {
        if ($this->pattern === '') {
            return $contents;
        }

        return preg_replace_callback($this->splitPattern, function (array $match) use (&$count, $logger) {
            $count++;
            $this->log($logger, sprintf(
                '    → Séquence éclatée masquée: %s%s%s%s%s%s%s%s%s',
                $match[1],
                $match[2],
                $match[3],
                $match[4],
                $match[5],
                $match[6],
                $match[7],
                $match[8],
                $match[9],
            ));

            $match[1] = preg_replace('/\d/', 'X', $match[1]);
            $match[3] = preg_replace('/[A-Z]/i', 'X', $match[3]);
            $match[5] = preg_replace('/\d/', 'X', $match[5]);
            $match[7] = preg_replace('/\d/', 'X', $match[7]);
            $match[9] = preg_replace('/[A-Z]/i', 'X', $match[9]);

            return $match[1].$match[2].$match[3].$match[4].$match[5].$match[6].$match[7].$match[8].$match[9];
        }, $contents);
    }

    protected function rebuildPdf(string $qdfPath): string
    {
        $command = $this->commandResolver->resolve();
        $rebuiltPath = sys_get_temp_dir().'/cac_demat_clean_'.Str::uuid().'.pdf';

        $process = new Process([
            $command,
            $qdfPath,
            $rebuiltPath,
        ]);
        $process->setTimeout(null);
        $process->run();

        $success = $process->isSuccessful() && file_exists($rebuiltPath);

        if (! $success) {
            if (file_exists($rebuiltPath)) {
                @unlink($rebuiltPath);
            }

            $error = trim($process->getErrorOutput() ?: $process->getOutput());

            throw new RuntimeException(sprintf(
                'Impossible de reconstruire le PDF nettoyé. Commande: %s. Erreur: %s',
                $command,
                $error !== '' ? $error : 'inconnue'
            ));
        }

        return $rebuiltPath;
    }

    protected function log(?callable $logger, string $message): void
    {
        if ($logger) {
            $logger($message);
        }
    }
}
