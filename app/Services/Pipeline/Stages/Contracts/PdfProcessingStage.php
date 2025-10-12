<?php

namespace App\Services\Pipeline\Stages\Contracts;

use App\Services\Pdf\PdfProcessingContext;

interface PdfProcessingStage
{
    public function process(PdfProcessingContext $context, ?callable $logger = null): PdfProcessingContext;
}
