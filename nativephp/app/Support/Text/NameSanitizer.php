<?php

namespace App\Support\Text;

class NameSanitizer
{
    public static function sanitize(string $name, string $fallback): string
    {
        $sanitised = preg_replace('/[^\pL\pN._-]+/u', '_', trim($name));

        if ($sanitised === null || $sanitised === '') {
            return $fallback;
        }

        return $sanitised;
    }
}
