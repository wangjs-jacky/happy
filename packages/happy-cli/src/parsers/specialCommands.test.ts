import { describe, it, expect } from 'vitest';
import { parseCompact, parseClear, parseSpecialCommand } from './specialCommands';

describe('parseCompact', () => {
    it('should parse /compact command with argument', () => {
        const result = parseCompact('/compact optimize the code');
        expect(result.isCompact).toBe(true);
        expect(result.originalMessage).toBe('/compact optimize the code');
    });

    it('should parse /compact command without argument', () => {
        const result = parseCompact('/compact');
        expect(result.isCompact).toBe(true);
        expect(result.originalMessage).toBe('/compact');
    });

    it('should not parse regular messages', () => {
        const result = parseCompact('hello world');
        expect(result.isCompact).toBe(false);
        expect(result.originalMessage).toBe('hello world');
    });

    it('should not parse messages that contain compact but do not start with /compact', () => {
        const result = parseCompact('please /compact this');
        expect(result.isCompact).toBe(false);
        expect(result.originalMessage).toBe('please /compact this');
    });
});

describe('parseClear', () => {
    it('should parse /clear command exactly', () => {
        const result = parseClear('/clear');
        expect(result.isClear).toBe(true);
    });

    it('should parse /clear command with whitespace', () => {
        const result = parseClear('  /clear  ');
        expect(result.isClear).toBe(true);
    });

    it('should not parse /clear with arguments', () => {
        const result = parseClear('/clear something');
        expect(result.isClear).toBe(false);
    });

    it('should not parse regular messages', () => {
        const result = parseClear('hello world');
        expect(result.isClear).toBe(false);
    });
});

describe('parseSpecialCommand', () => {
    it('should detect compact command', () => {
        const result = parseSpecialCommand('/compact optimize');
        expect(result.type).toBe('compact');
        expect(result.originalMessage).toBe('/compact optimize');
    });

    it('should detect clear command', () => {
        const result = parseSpecialCommand('/clear');
        expect(result.type).toBe('clear');
        expect(result.originalMessage).toBeUndefined();
    });

    it('should detect skills command', () => {
        const result = parseSpecialCommand('/skills');
        expect(result.type).toBe('skills');
        expect(result.originalMessage).toBeUndefined();
    });

    it('should detect Codex mobile command variants', () => {
        expect(parseSpecialCommand('/mcp')).toMatchObject({ type: 'mcp', mcp: { verbose: false } });
        expect(parseSpecialCommand('/mcp verbose')).toMatchObject({ type: 'mcp', mcp: { verbose: true } });
        expect(parseSpecialCommand('/usage')).toMatchObject({ type: 'usage', usage: { range: 'summary' } });
        expect(parseSpecialCommand('/usage daily')).toMatchObject({ type: 'usage', usage: { range: 'daily' } });
        expect(parseSpecialCommand('/usage weekly')).toMatchObject({ type: 'usage', usage: { range: 'weekly' } });
        expect(parseSpecialCommand('/usage cumulative')).toMatchObject({ type: 'usage', usage: { range: 'cumulative' } });
        expect(parseSpecialCommand('/status')).toMatchObject({ type: 'status' });
        expect(parseSpecialCommand('/diff')).toMatchObject({ type: 'diff' });
        expect(parseSpecialCommand('/new')).toMatchObject({ type: 'new' });
        expect(parseSpecialCommand('/fork')).toMatchObject({ type: 'fork' });
        expect(parseSpecialCommand('/review')).toMatchObject({
            type: 'review',
            review: { instructions: undefined },
        });
        expect(parseSpecialCommand('/review focus on regressions')).toMatchObject({
            type: 'review',
            review: { instructions: 'focus on regressions' },
        });
        expect(parseSpecialCommand('/plan')).toMatchObject({
            type: 'plan',
            plan: { prompt: undefined },
        });
        expect(parseSpecialCommand('/plan propose the migration')).toMatchObject({
            type: 'plan',
            plan: { prompt: 'propose the migration' },
        });
    });

    it('rejects unsupported arguments for strict Codex mobile commands', () => {
        expect(parseSpecialCommand('/mcp noisy').type).toBeNull();
        expect(parseSpecialCommand('/usage hourly').type).toBeNull();
        expect(parseSpecialCommand('/status now').type).toBeNull();
        expect(parseSpecialCommand('/diff stat').type).toBeNull();
        expect(parseSpecialCommand('/new task').type).toBeNull();
        expect(parseSpecialCommand('/fork task').type).toBeNull();
    });

    it('should detect goal command variants', () => {
        expect(parseSpecialCommand('/goal')).toMatchObject({
            type: 'goal',
            goal: { action: 'show' },
        });
        expect(parseSpecialCommand('/goal clear')).toMatchObject({
            type: 'goal',
            goal: { action: 'clear' },
        });
        expect(parseSpecialCommand('/goal pause')).toMatchObject({
            type: 'goal',
            goal: { action: 'pause' },
        });
        expect(parseSpecialCommand('/goal resume')).toMatchObject({
            type: 'goal',
            goal: { action: 'resume' },
        });
        expect(parseSpecialCommand('/goal edit')).toMatchObject({
            type: 'goal',
            goal: { action: 'edit' },
        });
        expect(parseSpecialCommand('/goal Reduce p95 latency')).toMatchObject({
            type: 'goal',
            goal: { action: 'set', objective: 'Reduce p95 latency' },
        });
        expect(parseSpecialCommand('/goalkeeper').type).toBeNull();
    });

    it('should return null for regular messages', () => {
        const result = parseSpecialCommand('hello world');
        expect(result.type).toBeNull();
        expect(result.originalMessage).toBeUndefined();
    });

    it('should handle edge cases correctly', () => {
        // Test with extra whitespace
        expect(parseSpecialCommand('  /compact test  ').type).toBe('compact');
        expect(parseSpecialCommand('  /clear  ').type).toBe('clear');
        
        // Test partial matches should not trigger
        expect(parseSpecialCommand('some /compact text').type).toBeNull();
        expect(parseSpecialCommand('/compactor').type).toBeNull();
        expect(parseSpecialCommand('/clearing').type).toBeNull();
    });
});
