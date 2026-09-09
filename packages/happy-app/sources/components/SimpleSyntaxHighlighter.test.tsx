import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';

vi.mock('react-native', () => ({
    Platform: { OS: 'web' },
    Text: 'Text',
    View: 'View',
}));
vi.mock('react-native-unistyles', () => ({
    useUnistyles: () => ({
        theme: {
            colors: new Proxy({}, { get: () => '#fff' }),
        },
    }),
}));

import { SimpleSyntaxHighlighter } from './SimpleSyntaxHighlighter';

describe('SimpleSyntaxHighlighter typography', () => {
    let renderer: any;

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterEach(() => {
        act(() => renderer?.unmount());
        renderer = undefined;
    });

    it('uses bundled Maple faces instead of synthesizing bold code tokens', () => {
        act(() => {
            renderer = TestRenderer.create(
                <SimpleSyntaxHighlighter
                    code="const answer = 1"
                    language="typescript"
                    selectable
                    typography="chatMono"
                />,
            );
        });

        const tokens = renderer.root.findAllByType('Text')
            .filter((node: any) => typeof node.props.children === 'string');
        const keyword = tokens.find((node: any) => node.props.children === 'const');
        const regular = tokens.find((node: any) => node.props.children.includes('answer'));

        expect(keyword.props.style).toMatchObject({
            fontFamily: 'MapleMonoNL-SemiBold',
            fontWeight: 'normal',
        });
        expect(regular.props.style).toMatchObject({
            fontFamily: 'MapleMonoNL-Regular',
        });

        act(() => {
            renderer.update(
                <SimpleSyntaxHighlighter
                    code="const answer = 1"
                    language="typescript"
                    selectable
                />,
            );
        });

        const defaultKeyword = renderer.root.findAllByType('Text')
            .find((node: any) => node.props.children === 'const');
        expect(defaultKeyword.props.style).toMatchObject({
            fontFamily: 'MapleMonoNL-Regular',
            fontWeight: '600',
        });
    });
});
