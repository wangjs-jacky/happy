import * as React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// react-test-renderer 没有随包发布 TypeScript 声明。
// @ts-expect-error 测试只使用 create/unmount 所需的最小接口。
import TestRenderer from 'react-test-renderer';

import { QRCode } from './QRCode';

vi.mock('react-native', () => ({
    View: 'View',
}));
vi.mock('@shopify/react-native-skia', () => ({
    Canvas: 'Canvas',
    DiffRect: 'DiffRect',
    Group: 'Group',
    Path: 'Path',
    Rect: 'Rect',
    RoundedRect: 'RoundedRect',
    rect: (...values: unknown[]) => values,
    rrect: (...values: unknown[]) => values,
}));
vi.mock('./qrMatrix', () => ({
    createQRMatrix: () => ({
        getNeighbors: () => ({
            bottom: false,
            current: false,
            left: false,
            right: false,
            top: false,
        }),
        size: 21,
    }),
}));

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('原生二维码', () => {
    it('为 Canvas 外层提供图像角色和持久名称', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <QRCode data="本地测试" accessibilityLabel="本地二维码" />,
            );
        });

        const wrapper = renderer.root.findByType('View');
        expect(wrapper.props.accessible).toBe(true);
        expect(wrapper.props.accessibilityRole).toBe('image');
        expect(wrapper.props.accessibilityLabel).toBe('本地二维码');

        act(() => renderer.unmount());
    });
});
