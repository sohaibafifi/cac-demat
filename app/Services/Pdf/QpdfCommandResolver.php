<?php

namespace App\Services\Pdf;

class QpdfCommandResolver
{
    public function resolve(): string
    {
        $embedded = $this->resolveEmbeddedCommand();
        if ($embedded !== null) {
            return $embedded;
        }

        $command = env('QPDF_COMMAND');

        return ($command && $command !== '') ? $command : 'qpdf';
    }

    protected function resolveEmbeddedCommand(): ?string
    {
        $basePath = base_path('resources/commands');

        $paths = match (PHP_OS_FAMILY) {
            'Windows' => [
                $basePath.'/win/qpdf.exe',
            ],
            'Darwin' => [
                $basePath.'/mac/qpdf',
            ],
            // TODO: add Linux support
            default => [],
        };

        foreach ($paths as $path) {
            if (is_file($path) && is_executable($path)) {
                return $path;
            }
        }

        return null;
    }
}
