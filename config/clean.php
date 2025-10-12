<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Sensitive Data Pattern
    |--------------------------------------------------------------------------
    |
    | Any text matching this regular expression will be redacted from generated
    | PDFs by the cleaning pipeline. The default pattern targets identifiers
    | shaped like XX-X-XXXXX-XXX (with optional spaces or dashes) and ending
    | with three uppercase letters.
    |
    */
    'pattern' => '/\\b\\d{2}[ -]?[GPAEBSNIKT][ -]?\\d{2}[ -]?\\d{5}[ -]?[A-Z]{3}\\b/',
];
