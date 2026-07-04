import type { ElementType } from 'react';

export interface ComposerAutocompleteSuggestion {
    key: string;
    text: string;
    insertText?: string;
    component: ElementType;
}
