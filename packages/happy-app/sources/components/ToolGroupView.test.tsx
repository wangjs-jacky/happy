import * as React from 'react';
import { act } from 'react';
import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';
import { TranscriptGroupExpansionContext } from './transcriptReading';
const grouping = vi.hoisted(() => ({ nested: [] as any[], messageRenders: [] as string[], calls: 0, summaryRenders: 0 }));

vi.mock('react-native', () => ({
    ActivityIndicator: 'ActivityIndicator',
    Platform: { OS: 'web', select: (options: Record<string, unknown>) => options.web ?? options.default },
    Pressable: 'Pressable',
    Text: 'Text',
    View: 'View',
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons', Octicons: 'Octicons' }));
vi.mock('@/hooks/useGroupedMessages', () => ({
    formatWorkDuration: (duration: number) => `${duration}ms`,
    generateGroupSummary: () => 'Read file',
    groupToolCallsForDisplay: () => { grouping.calls++; return grouping.nested; },
}));
vi.mock('@/utils/toolDisplay', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/utils/toolDisplay')>();
    return { ...actual, getToolSummaryDetail: (...args: Parameters<typeof actual.getToolSummaryDetail>) => {
        grouping.summaryRenders++;
        return actual.getToolSummaryDetail(...args);
    } };
});
vi.mock('@/text', () => ({ t: (key: string, values?: { duration?: string }) => values?.duration ?? key }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('./MessageView', () => ({ MessageView: (props: any) => {
    grouping.messageRenders.push(props.message.id);
    return React.createElement('MessageView', props);
} }));
vi.mock('./layout', () => ({ layout: { maxWidth: 800 } }));
vi.mock('./tools/views/MCPToolView', () => ({ formatMCPTitle: (name: string) => name }));
vi.mock('./ConversationActivityStrip', () => ({
    ConversationActivityStrip: 'ConversationActivityStrip',
    ConversationActivitySuppressedContext: React.createContext(false),
}));

const { theme } = vi.hoisted(() => ({ theme: {
    colors: {
        divider: '#333',
        surfacePressed: '#292929',
        text: '#fff',
        textSecondary: '#aaa',
    },
} }));
vi.mock('react-native-unistyles', () => ({
    useUnistyles: () => ({ theme }),
    StyleSheet: { create: (factory: any) => factory(theme) },
}));

import { AgentWorkGroupView } from './ToolGroupView';

describe('AgentWorkGroupView', () => {
    beforeEach(() => {
        grouping.nested = [];
        grouping.messageRenders = [];
        grouping.calls = 0;
        grouping.summaryRenders = 0;
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterEach(() => {
        vi.useRealTimers();
        Platform.OS = 'web';
        delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    });


    it('does no nested grouping while collapsed, including incoming history', () => {
        const group: any = { type: 'agent-work-group', id: 'work', messages: [], hasRunning: false,
            hasPendingPermission: false, startedAt: 1, completedAt: 2 };
        let renderer: any;
        const render = (expanded: boolean) => <AgentWorkGroupView group={{ ...group, messages: [...group.messages] }}
            metadata={null} expanded={expanded} onToggle={() => {}} />;
        act(() => { renderer = TestRenderer.create(render(false)); });
        act(() => renderer.update(render(false)));
        expect(grouping.calls).toBe(0);
        act(() => renderer.update(render(true)));
        expect(grouping.calls).toBe(1);
        act(() => renderer.unmount());
    });

    it('updates the live duration without rerendering 200 actual terminal summary rows', () => {
        vi.useFakeTimers();
        vi.setSystemTime(10_000);
        const messages = Array.from({ length: 200 }, (_, i) => ({ id: `m-${i}`, kind: 'tool-call', createdAt: 1,
            tool: { name: 'Bash', input: { command: `echo ${i}` }, state: 'completed' } }));
        grouping.nested = [{ type: 'tool-group', id: 'tools', messages, hasRunning: false, hasPendingPermission: false }];
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<TranscriptGroupExpansionContext.Provider value={{ isExpanded: () => true, toggle: () => {} }}>
            <AgentWorkGroupView group={{ type: 'agent-work-group', id: 'work',
                messages: messages as any, hasRunning: true, hasPendingPermission: false, startedAt: 1_000,
                completedAt: null }} metadata={null} expanded onToggle={() => {}} />
        </TranscriptGroupExpansionContext.Provider>); });
        const renders = grouping.summaryRenders;
        expect(renders).toBeGreaterThanOrEqual(200);
        act(() => vi.advanceTimersByTime(3_000));
        expect(JSON.stringify(renderer.toJSON())).toContain('12000ms');
        expect(grouping.summaryRenders).toBe(renders);
        act(() => renderer.unmount());
    });

    it('preserves a manually opened nested group when history or new messages update', () => {
        const messages = ['one', 'two'].map(id => ({ id, kind: 'agent-text', text: id, createdAt: 1 }));
        const nested = () => ({ type: 'tool-group', id: 'tools', messages: [...messages], hasRunning: false,
            hasPendingPermission: false });
        grouping.nested = [nested()];
        const render = (expanded = true) => <AgentWorkGroupView group={{ type: 'agent-work-group', id: 'work',
            messages: [...messages] as any, hasRunning: false, hasPendingPermission: false,
            startedAt: 1, completedAt: 2 }} metadata={null} expanded={expanded} onToggle={() => {}} />;
        let renderer: any;
        act(() => { renderer = TestRenderer.create(render()); });
        act(() => renderer.root.findByProps({ testID: 'conversation-tool-group-toggle' }).props.onPress());
        grouping.nested = [nested()];
        act(() => renderer.update(render()));
        expect(renderer.root.findAllByType('MessageView')).toHaveLength(2);
        act(() => renderer.update(render(false)));
        act(() => renderer.update(render(true)));
        expect(renderer.root.findAllByType('MessageView')).toHaveLength(2);
        act(() => renderer.unmount());
    });

    it.each(['web', 'android'] as const)('preserves permission and manual expansion intent across outer reopening on %s', (platform) => {
        Platform.OS = platform;
        const messages = ['one', 'two'].map(id => ({ id, kind: 'agent-text', text: id, createdAt: 1 }));
        const render = (pending: boolean, expanded = true) => {
            grouping.nested = [{ type: 'tool-group', id: 'tools', messages: [...messages], hasRunning: false,
                hasPendingPermission: pending }];
            return <AgentWorkGroupView group={{ type: 'agent-work-group', id: 'work', messages: [...messages] as any,
                hasRunning: false, hasPendingPermission: pending, startedAt: 1, completedAt: 2 }}
                metadata={null} expanded={expanded} onToggle={() => {}} />;
        };
        let renderer: any;
        act(() => { renderer = TestRenderer.create(render(false)); });
        const rows = () => renderer.root.findAllByType('MessageView');
        expect(rows()).toHaveLength(0);
        act(() => renderer.update(render(true)));
        expect(rows()).toHaveLength(2);
        // Resolution must not close a group the reader is inspecting.
        act(() => renderer.update(render(false)));
        expect(rows()).toHaveLength(2);
        act(() => renderer.update(render(false, false)));
        expect(rows()).toHaveLength(0);
        act(() => renderer.update(render(false)));
        expect(rows()).toHaveLength(2);
        act(() => renderer.root.findByProps({ testID: 'conversation-tool-group-toggle' }).props.onPress());
        expect(rows()).toHaveLength(0);
        // Explicit collapse wins over a later permission update, including while hidden.
        act(() => renderer.update(render(true, false)));
        act(() => renderer.update(render(true)));
        expect(rows()).toHaveLength(0);
        act(() => renderer.root.findByProps({ testID: 'conversation-tool-group-toggle' }).props.onPress());
        expect(rows()).toHaveLength(2);
        act(() => renderer.unmount());
    });

    it('shows the summary category icon beside the disclosure chevron', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <AgentWorkGroupView
                    group={{
                        type: 'agent-work-group',
                        id: 'work-1',
                        messages: [{
                            id: 'read-1',
                            kind: 'tool-call',
                            createdAt: 1,
                            tool: { name: 'Read', input: { file_path: '/tmp/a.ts' }, state: 'completed' },
                        }] as any,
                        hasRunning: false,
                        hasPendingPermission: false,
                        startedAt: 1_000,
                        completedAt: 2_000,
                    }}
                    metadata={null}
                    expanded={false}
                    onToggle={() => undefined}
                />,
            );
        });

        const toggle = renderer.root.findByProps({ testID: 'conversation-agent-work-toggle' });
        expect(toggle.findByProps({ testID: 'conversation-tool-summary-icon' }).findByType('Octicons').props.name).toBe('eye');
        expect(toggle.findByProps({ testID: 'conversation-collapse-chevron' }).props.name).toBe('chevron-forward');

        act(() => renderer.unmount());
    });

    it('never mounts closed nested tool output during history discovery', () => {
        const messages = ['one', 'two'].map(id => ({ id, kind: 'agent-text', text: id, createdAt: 1, localId: null }));
        const render = () => <AgentWorkGroupView group={{ type: 'agent-work-group', id: 'work',
            messages: [...messages] as any, hasRunning: false, hasPendingPermission: false,
            startedAt: 1, completedAt: 2 }} metadata={null} expanded onToggle={() => {}} />;
        let renderer: any;
        act(() => { renderer = TestRenderer.create(render()); });
        grouping.nested = [{ type: 'tool-group', id: 'historical-tools', messages,
            hasRunning: false, hasPendingPermission: false }];
        act(() => renderer.update(render()));
        expect(grouping.messageRenders).toEqual([]);
        act(() => renderer.root.findByProps({ testID: 'conversation-tool-group-toggle' }).props.onPress());
        expect(renderer.root.findAllByType('MessageView')).toHaveLength(2);
        act(() => renderer.unmount());
    });

    it('restores nested tool-group expansion from the durable reading context', () => {
        const messages = ['one', 'two'].map(id => ({ id, kind: 'agent-text', text: id, createdAt: 1, localId: null }));
        grouping.nested = [{ type: 'tool-group', id: 'replayed-group', messages, hasRunning: false, hasPendingPermission: false }];
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<TranscriptGroupExpansionContext.Provider value={{ isExpanded: () => true, toggle: vi.fn() }}>
            <AgentWorkGroupView group={{ type: 'agent-work-group', id: 'work', messages: messages as any, hasRunning: false,
                hasPendingPermission: false, startedAt: 1, completedAt: 2 }} metadata={null} expanded onToggle={() => {}} />
        </TranscriptGroupExpansionContext.Provider>); });
        expect(renderer.root.findAllByType('MessageView')).toHaveLength(2);
        act(() => renderer.unmount());
    });
});

vi.mock('@/hooks/useDesktopFileWorkspaceAvailable', () => ({ useDesktopFileWorkspaceAvailable: () => false }));
