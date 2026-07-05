import Fuse from 'fuse.js';
import { storage } from './storage';

export interface SkillItem {
    name: string;
}

interface SearchOptions {
    limit?: number;
    threshold?: number;
}

function getSkillsFromSession(sessionId: string): SkillItem[] {
    const state = storage.getState();
    const session = state.sessions[sessionId];
    const names = session?.metadata?.skills ?? [];
    const deduped = new Set<string>();

    for (const name of names) {
        deduped.add(name);
    }

    return [...deduped].map((name) => ({ name }));
}

function normalizeQuery(query: string): string {
    if (query.startsWith('/') || query.startsWith('$')) {
        return query.slice(1);
    }
    return query;
}

export async function searchSkills(
    sessionId: string,
    query: string,
    options: SearchOptions = {},
): Promise<SkillItem[]> {
    const { limit = 10, threshold = 0.3 } = options;
    const skills = getSkillsFromSession(sessionId);
    const normalizedQuery = normalizeQuery(query).trim();

    if (!normalizedQuery) {
        return skills.slice(0, limit);
    }

    const fuse = new Fuse(skills, {
        keys: [{ name: 'name', weight: 1 }],
        threshold,
        includeScore: true,
        shouldSort: true,
        minMatchCharLength: 1,
        ignoreLocation: true,
        useExtendedSearch: true,
    });

    return fuse.search(normalizedQuery, { limit }).map((result) => result.item);
}

export function getAllSkills(sessionId: string): SkillItem[] {
    return getSkillsFromSession(sessionId);
}
