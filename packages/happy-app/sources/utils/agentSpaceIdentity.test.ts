import { describe, expect, it } from 'vitest';
import {
    canonicalizeAgentPath,
    hasDuplicateAgentPath,
    matchAgentForSession,
    selectAgentSpaceSessions,
} from './agentSpaceIdentity';

describe.each([
    ['~/work/', '/Users/jacky', '/Users/jacky/work'],
    ['/Users/jacky/work/', '/Users/jacky', '/Users/jacky/work'],
    ['C:\\Users\\Jacky\\Work\\', 'C:\\Users\\Jacky', 'c:/users/jacky/work'],
    ['\\\\Server\\Share\\Health', 'C:\\Users\\Jacky', '//server/share/health'],
])('canonicalizeAgentPath', (input, homeDir, expected) => {
    it(`${input} -> ${expected}`, () => {
        expect(canonicalizeAgentPath(input, homeDir)).toBe(expected);
    });
});

it('returns null when a tilde path has no home directory', () => {
    expect(canonicalizeAgentPath('~/work', undefined)).toBeNull();
});

it('canonicalizes a tilde Windows drive root identically to the direct root', () => {
    const fromTilde = canonicalizeAgentPath('~', 'C:\\');
    const direct = canonicalizeAgentPath('C:\\', 'C:\\');

    expect(fromTilde).toBe('c:/');
    expect(direct).toBe('c:/');
    expect(fromTilde).toBe(direct);
});

it('canonicalizes a tilde UNC home root identically to the direct root', () => {
    const fromTilde = canonicalizeAgentPath('~', '\\\\Server\\Share\\');
    const direct = canonicalizeAgentPath('\\\\Server\\Share\\', 'C:\\Users\\Jacky');

    expect(fromTilde).toBe('//server/share/');
    expect(direct).toBe('//server/share/');
    expect(fromTilde).toBe(direct);
});

it('canonicalizes a tilde UNC home without a trailing separator as a share root', () => {
    const fromTilde = canonicalizeAgentPath('~', '\\\\Server\\Share');
    const direct = canonicalizeAgentPath('\\\\Server\\Share\\', 'C:\\Users\\Jacky');

    expect(fromTilde).toBe('//server/share/');
    expect(fromTilde).toBe(direct);
});

it('collapses three or more leading separators to the canonical UNC prefix', () => {
    expect(canonicalizeAgentPath('////Server///Share', undefined)).toBe('//server/share/');
});

it('prefers agentSpaceId among duplicate canonical candidates', () => {
    const agents = [
        { id: 'first', machineId: 'm1', path: '~/work' },
        { id: 'chosen', machineId: 'm1', path: '/Users/jacky/work/' },
    ];

    expect(matchAgentForSession({
        agents,
        agentSpaceId: 'chosen',
        machineId: 'm1',
        sessionPath: '/Users/jacky/work',
        homeDir: '/Users/jacky',
    })?.id).toBe('chosen');
});

it('returns null for ambiguous duplicates without agentSpaceId', () => {
    const agents = [
        { id: 'first', machineId: 'm1', path: '~/work' },
        { id: 'second', machineId: 'm1', path: '/Users/jacky/work' },
    ];

    expect(matchAgentForSession({
        agents,
        agentSpaceId: null,
        machineId: 'm1',
        sessionPath: '/Users/jacky/work',
        homeDir: '/Users/jacky',
    })).toBeNull();
});

it('detects duplicate machine plus canonical path in the editor', () => {
    expect(hasDuplicateAgentPath({
        agents: [{ id: 'existing', machineId: 'm1', path: '~/work' }],
        editingId: null,
        machineId: 'm1',
        path: '/Users/jacky/work/',
        homeDir: '/Users/jacky',
    })).toBe(true);
});

it('filters Agent-space sessions canonically and sorts active sessions first then newest', () => {
    const sessions = [
        { id: 'older-active', metadata: { machineId: 'm1', path: '/Users/jacky/work/' }, active: true, createdAt: 10 },
        { id: 'newer-inactive', metadata: { machineId: 'm1', path: '/Users/jacky/work' }, active: false, createdAt: 30 },
        { id: 'newer-active', metadata: { machineId: 'm1', path: '/Users/jacky/work' }, active: true, createdAt: 20 },
        { id: 'other', metadata: { machineId: 'm1', path: '/Users/jacky/other' }, active: true, createdAt: 40 },
    ];

    expect(selectAgentSpaceSessions({
        sessions,
        machineId: 'm1',
        agentPath: '~/work',
        homeDir: '/Users/jacky',
    }).map((session) => session.id)).toEqual(['newer-active', 'older-active', 'newer-inactive']);
});
