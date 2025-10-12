<?php

namespace App\Services\Pipeline\Contracts;

use App\Services\Pipeline\PdfProcessingContext;

interface PdfProcessingStage
{
    public function process(PdfProcessingContext $context, ?callable $logger = null): PdfProcessingContext;
}
