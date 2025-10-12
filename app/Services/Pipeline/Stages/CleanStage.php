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
    public function __construct(
        protected string $pattern,
        protected QpdfCommandResolver $commandResolver
    ) {
        $pattern = trim($pattern);

        if ($pattern === '' || $this->patternIsInvalid($pattern)) {
            $this->pattern = '';
        } else {
            $this->pattern = $pattern;
        }
    }

    public function process(PdfProcessingContext $context, ?callable $logger = null): PdfProcessingContext
    {
        if ($this->pattern === '') {
            return $context;
        }

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
        $sanitised = @preg_replace_callback($this->pattern, function (array $hit) use (&$count, $logger) {
            $count++;
            $this->log($logger, sprintf('    → Séquence masquée: %s', $hit[0]));

            return str_repeat('X', strlen($hit[0]));
        }, $contents);

        if ($sanitised === null) {
            $this->log($logger, sprintf('    ⚠️ Motif de nettoyage désactivé (erreur PCRE: %d)', preg_last_error()));
            $this->pattern = '';

            return false;
        }

        if ($count === 0) {
            return false;
        }

        if (file_put_contents($path, $sanitised) === false) {
            throw new RuntimeException(sprintf('Impossible d\'écrire le fichier QDF nettoyé: %s', $path));
        }

        $this->log($logger, sprintf('    → %d occurrence(s) masquées', $count));

        return true;
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

    protected function patternIsInvalid(string $pattern): bool
    {
        set_error_handler(static fn () => false);
        $result = @preg_match($pattern, '');
        restore_error_handler();

        return $result === false;
    }

    protected function log(?callable $logger, string $message): void
    {
        if ($logger) {
            $logger($message);
        }
    }
}
