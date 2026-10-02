import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';
import type { ToolCall } from '@/sync/typesMessage';

const mocks = vi.hoisted(() => ({ language: 'en' as 'en' | 'zh-Hans', routerPush: vi.fn() }));

vi.mock('react-native', () => ({
    ActivityIndicator: 'ActivityIndicator',
    Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default },
    Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View',
}));
vi.mock('react-native-unistyles', () => {
    const theme = { colors: { surfaceHigh: '#111', surfaceHighest: '#222', text: '#fff', textSecondary: '#aaa', warning: '#f90' } };
    return {
        StyleSheet: { create: (factory: (value: typeof theme) => object) => factory(theme) },
        useUnistyles: () => ({ theme }),
    };
});
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons', Octicons: 'Octicons' }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.routerPush }) }));
vi.mock('@/text', async () => {
    const { en } = await import('@/text/translations/en');
    const { zhHans } = await import('@/text/translations/zh-Hans');
    return {
        t: (key: string) => key.split('.').reduce<any>((value, part) => value[part], mocks.language === 'en' ? en : zhHans),
    };
});
vi.mock('@/hooks/useElapsedTime', () => ({ useElapsedTime: () => 1 }));
vi.mock('@/utils/toolDisplay', () => ({
    getTerminalToolCommand: () => null,
    isInlineAudioFileTool: () => false,
    isInlineImageFileTool: () => false,
    isInlineVideoFileTool: () => false,
    shouldRenderToolCardHeader: () => true,
}));
vi.mock('./views/_all', () => ({ getToolViewComponent: () => null }));
vi.mock('./PermissionFooter', () => ({ PermissionFooter: 'PermissionFooter' }));
vi.mock('./ToolError', () => ({ ToolError: 'ToolError' }));
vi.mock('../CodeView', () => ({ CodeView: 'CodeView' }));
vi.mock('./ToolSectionView', () => ({ ToolSectionView: 'ToolSectionView' }));
vi.mock('./McpAppHost', () => ({ McpAppHost: 'McpAppHost' }));

import { ToolView } from './ToolView';

function makeTool(overrides: Partial<ToolCall> = {}): ToolCall {
    return {
        callId: 'agent-tool-call', name: 'McpTool', state: 'completed',
        input: { server: 'happy', tool: 'agent_save', arguments: { instructions: 'Long private instructions', path: '/private/skills/SKILL.md' } },
        result: { content: [{ type: 'text', text: 'Long saved profile JSON' }] },
        createdAt: 1, startedAt: 1, completedAt: 2, description: 'happy.agent_save',
        ...overrides,
    };
}

describe('ToolView Happy Agent actions', () => {
    let renderer: any;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        mocks.language = 'en';
        mocks.routerPush.mockClear();
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        if (renderer) act(() => renderer.unmount());
        renderer = undefined;
        consoleErrorSpy.mockRestore();
    });

    function render(tool: ToolCall) {
        act(() => {
            renderer = TestRenderer.create(<ToolView metadata={null} tool={tool} sessionId="session-1" messageId="message-1" />);
        });
        return renderer.root;
    }

    it.each([
        ['agent_save', 'Save Agent', '保存 Agent'],
        ['agent_get', 'Read Agent', '读取 Agent'],
        ['agent_list', 'View Agents', '查看 Agents'],
        ['agent_skills', 'View available Skills', '查看可用 Skills'],
        ['agent_builder', 'Prepare Agent creation', '准备创建 Agent'],
        ['agent_archive', 'Update archive status', '更新归档状态'],
        ['change_title', 'Update session title', '更新会话标题'],
    ])('keeps %s compact and translates the action on render', (name, english, chinese) => {
        const tool = makeTool();
        tool.input = { ...tool.input, tool: name };
        const root = render(tool);
        expect(root.findAllByType('Text').some((node: any) => node.children.includes(english))).toBe(true);
        expect(root.findAllByType('CodeView')).toHaveLength(0);
        expect(JSON.stringify(renderer.toJSON())).not.toContain('Long private instructions');

        mocks.language = 'zh-Hans';
        act(() => {
            renderer.update(<ToolView metadata={null} tool={{ ...tool }} sessionId="session-1" messageId="message-1" />);
        });
        expect(root.findAllByType('Text').some((node: any) => node.children.includes(chinese))).toBe(true);
        expect(root.findAllByType('CodeView')).toHaveLength(0);
    });

    it.each([
        ['McpTool', 'other', 'agent_save'],
        ['McpTool', 'happy-copy', 'agent_save'],
        ['McpTool', 'Happy', 'agent_save'],
        ['McpTool', 'happy', 'agent_save_copy'],
        ['McpTool', 'happy', 'unknown'],
        ['McpTool', 'happy', 'constructor'],
        ['McpTool', 'happy', '__proto__'],
        ['MCPTool', 'happy', 'agent_save'],
        ['unknown', 'happy', 'agent_save'],
        ['McpTool', 'other', 'change_title'],
        ['McpTool', 'happy', 'change_title_copy'],
        ['MCPTool', 'happy', 'change_title'],
    ])('preserves the generic view for %s / %s / %s', (name, server, action) => {
        const tool = makeTool({ name, input: { server, tool: action, arguments: { untouched: true } } });
        const root = render(tool);
        expect(root.findAllByType('CodeView').map((node: any) => node.props.code)).toEqual([
            JSON.stringify(tool.input, null, 2), JSON.stringify(tool.result, null, 2),
        ]);
        expect(root.findAllByType('Text').some((node: any) => node.children.includes(name))).toBe(true);
    });

    it('retains ordinary named MCP presentation rather than relabeling it as an Agent action', () => {
        const root = render(makeTool({ name: 'mcp__happy__agent_save' }));
        expect(root.findAllByType('Text').some((node: any) => node.children.includes('MCP: Happy Agent Save'))).toBe(true);
    });

    it('keeps detail navigation without changing the original arguments or results', () => {
        const tool = makeTool();
        const original = JSON.stringify(tool);
        const root = render(tool);
        act(() => root.findByProps({ testID: 'tool-card-header' }).props.onPress());
        expect(mocks.routerPush).toHaveBeenCalledWith('/session/session-1/message/message-1');
        expect(JSON.stringify(tool)).toBe(original);
    });

    it.each(['agent_save', 'change_title'])('keeps %s failures visible even when there is no result body', (action) => {
        const root = render(makeTool({ input: { server: 'happy', tool: action }, state: 'error', result: undefined, failure: { summary: 'Update failed' } }));
        expect(root.findAllByType('Text').some((node: any) => node.children.includes(' failed'))).toBe(true);
        expect(root.findAllByProps({ name: 'alert-circle-outline' }).length).toBeGreaterThan(0);
        expect(root.findAllByType('CodeView')).toHaveLength(0);
        act(() => root.findByProps({ testID: 'tool-card-header' }).props.onPress());
        expect(mocks.routerPush).toHaveBeenCalledWith('/session/session-1/message/message-1');
    });

    it('retains denied permission status and the permission footer', () => {
        const root = render(makeTool({ state: 'error', permission: { id: 'permission-1', status: 'denied' }, result: 'Permission denied' }));
        expect(root.findAllByProps({ name: 'remove-circle-outline' }).length).toBeGreaterThan(0);
        expect(root.findAllByType('PermissionFooter')).toHaveLength(1);
        expect(root.findAllByType('Text').some((node: any) => node.children.includes(' failed'))).toBe(true);
    });

    it.each(['agent_save', 'change_title'])('retains the running indicator for %s', (action) => {
        const root = render(makeTool({ input: { server: 'happy', tool: action }, state: 'running', result: undefined, completedAt: null }));
        expect(root.findAllByType('ActivityIndicator')).toHaveLength(1);
        expect(root.findAllByType('CodeView')).toHaveLength(0);
    });
});
