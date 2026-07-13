import { describe, it, expect } from 'vitest';
import { recentSessionsForAgent } from './recentSessionsForAgent';
import type { Session, Machine } from '@/sync/storageTypes';

// 只造出被测函数用到的字段，其余用 as any 收口，保持测试聚焦。
function session(id: string, machineId: string, path: string, updatedAt: number): Session {
    return { id, updatedAt, metadata: { machineId, path } } as any as Session;
}
const machine = (id: string, homeDir?: string): Machine => ({ id, metadata: { homeDir } } as any as Machine);
const agent = (machineId: string, path: string) => ({ machineId, path });

describe('recentSessionsForAgent', () => {
    const m = [machine('mac', '/Users/jacky')];

    it('只留 machineId 与解析后 path 都匹配的会话', () => {
        const sessions = [
            session('a', 'mac', '/Users/jacky/health', 100),
            session('b', 'other', '/Users/jacky/health', 200), // 机器不符
            session('c', 'mac', '/Users/jacky/other', 300),     // 路径不符
        ];
        const out = recentSessionsForAgent({ agent: agent('mac', '/Users/jacky/health'), sessions, machines: m });
        expect(out.map(s => s.id)).toEqual(['a']);
    });

    it('把 agent 的 ~ 路径按机器 homeDir 解析后再比对', () => {
        const sessions = [session('a', 'mac', '/Users/jacky/health', 100)];
        const out = recentSessionsForAgent({ agent: agent('mac', '~/health'), sessions, machines: m });
        expect(out.map(s => s.id)).toEqual(['a']);
    });

    it('忽略结尾斜杠差异', () => {
        const sessions = [session('a', 'mac', '/Users/jacky/health/', 100)];
        const out = recentSessionsForAgent({ agent: agent('mac', '/Users/jacky/health'), sessions, machines: m });
        expect(out.map(s => s.id)).toEqual(['a']);
    });

    it('按 updatedAt 倒序并截断到 limit', () => {
        const sessions = [
            session('old', 'mac', '/Users/jacky/health', 100),
            session('new', 'mac', '/Users/jacky/health', 300),
            session('mid', 'mac', '/Users/jacky/health', 200),
        ];
        const out = recentSessionsForAgent({ agent: agent('mac', '/Users/jacky/health'), sessions, machines: m, limit: 2 });
        expect(out.map(s => s.id)).toEqual(['new', 'mid']);
    });

    it('无匹配返回空数组', () => {
        expect(recentSessionsForAgent({ agent: agent('mac', '/Users/jacky/none'), sessions: [], machines: m })).toEqual([]);
    });
});
