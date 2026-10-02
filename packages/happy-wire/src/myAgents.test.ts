import { describe, expect, it } from 'vitest';
import { parseMyAgentCommand } from './myAgents';

describe('explicit Agent management command', () => {
    it.each([
        ['/agent', ''],
        ['  /AGENT 创建军师  ', '创建军师'],
        ['/agent\n修改军师\n回答简短一点', '修改军师\n回答简短一点'],
        ['/agent\tCreate a helper', 'Create a helper'],
    ])('recognizes only the leading command: %s', (text, request) => {
        expect(parseMyAgentCommand(text)).toEqual({ request });
    });
    it.each(['/agents', '/agent-builder', '/agent/help', '/agent创建', '请解释 /agent', '`/agent 创建`', '```\n/agent 创建\n```', '> /agent 创建', 'Hello\n/agent 创建'])('keeps prose, paths and other commands unchanged: %s', text => {
        expect(parseMyAgentCommand(text)).toBeNull();
    });
});
