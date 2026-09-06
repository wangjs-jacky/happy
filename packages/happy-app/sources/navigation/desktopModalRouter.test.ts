import { describe, expect, it, vi } from 'vitest';
import { StackActions, StackRouter } from '@react-navigation/routers';
vi.mock('@react-navigation/native', () => ({ StackRouter }));
import { createDesktopModalRouter, getDesktopModalStart, getDesktopModalBackgroundPath } from './desktopModalRouter';

const options = { routeNames: ['index', 'inbox/index', 'settings/index', 'settings/appearance', 'settings/profile', 'session/[id]', 'machine/[id]', 'dev/index', 'dev/logs', 'relationship-advisor'], routeParamList: {}, routeGetIdList: {} };
function setup() {
    const original = StackRouter({ initialRouteName: 'index' });
    const router = createDesktopModalRouter({ initialRouteName: 'index' });
    let state = original.getInitialState(options);
    const send = (action: any) => state = router.getStateForAction(state, action, options) ?? state;
    return { send, get state() { return state; } };
}

describe('desktop modal navigation boundary', () => {
    it('retains the exact background and keeps nested destinations inside until close', () => {
        const app = setup();
        app.send(StackActions.push('session/[id]', { id: 'background' }));
        const background = app.state.routes;
        app.send(StackActions.push('inbox/index', { desktopModal: '1' }));
        expect(getDesktopModalStart(app.state)).toBe(2);
        expect(app.state.routes.at(-1)?.params).not.toHaveProperty('desktopModal');
        app.send(StackActions.push('session/[id]', { id: 'attached' }));
        app.send(StackActions.push('machine/[id]', { id: 'computer' }));
        expect(getDesktopModalStart(app.state)).toBe(2);
        app.send({ type: 'CLOSE_DESKTOP_MODAL' });
        expect(app.state.routes).toEqual(background);
        expect(getDesktopModalStart(app.state)).toBe(-1);
    });

    it('keeps replace at the modal root in the modal', () => {
        const app = setup();
        app.send(StackActions.push('settings/index', { desktopModal: '1' }));
        app.send(StackActions.replace('relationship-advisor'));
        expect(getDesktopModalStart(app.state)).toBe(1);
        app.send({ type: 'GO_BACK' });
        expect(app.state.routes.map(r => r.name)).toEqual(['index']);
        expect(getDesktopModalStart(app.state)).toBe(-1);
    });

    it('does not let navigate or dismissTo a background destination escape', () => {
        const app = setup();
        app.send(StackActions.push('settings/index', { desktopModal: '1' }));
        const base = app.state.routes[0];
        app.send({ type: 'NAVIGATE', payload: { name: 'index' } });
        expect(app.state.routes[0]).toBe(base);
        expect(app.state.routes.filter(r => r.name === 'index')).toHaveLength(2);
        expect(getDesktopModalStart(app.state)).toBe(1);
        app.send(StackActions.popToTop());
        app.send(StackActions.popTo('session/[id]', { id: 'new' }));
        expect(getDesktopModalStart(app.state)).toBe(1);
        expect(app.state.routes[0]).toBe(base);
    });

    it('pops nested pages one at a time and preserves mobile/narrow entry behavior', () => {
        const app = setup();
        app.send(StackActions.push('settings/index'));
        expect(getDesktopModalStart(app.state)).toBe(-1);
        app.send({ type: 'GO_BACK' });
        app.send(StackActions.push('settings/index', { desktopModal: '1' }));
        app.send(StackActions.push('dev/index'));
        app.send(StackActions.push('dev/logs'));
        app.send({ type: 'GO_BACK' });
        expect(app.state.routes.at(-1)?.name).toBe('dev/index');
        app.send({ type: 'CLOSE_DESKTOP_MODAL' });
        app.send(StackActions.push('inbox/index', { desktopModal: '1' }));
        expect(app.state.routes.map(r => r.name)).toEqual(['index', 'inbox/index']);
    });
});

describe('modal boundary edge actions', () => {
    it('clamps a bulk dismiss to the background and does not mutate input state on no-op', () => {
        const app = setup();
        app.send(StackActions.push('session/[id]', { id: 'background' }));
        const before = app.state;
        app.send(StackActions.push('inbox/index', { desktopModal: '1' }));
        const active = app.state;
        app.send(StackActions.pop(99));
        expect(app.state.routes).toEqual(before.routes);
        expect(getDesktopModalStart(active)).toBe(2);
    });
});

describe('restored desktop modal state', () => {
    it('keeps the workspace on the background route across modal descendants', () => {
        const app = setup();
        app.send(StackActions.push('session/[id]', { id: 'main-session' }));
        app.send(StackActions.push('settings/index', { desktopModal: '1' }));
        app.send(StackActions.push('settings/appearance'));
        const root = { index: 0, routes: [{ key: 'app', name: '(app)', state: app.state }] };
        expect(getDesktopModalBackgroundPath(root)).toBe('/session/main-session');
        app.send({ type: 'CLOSE_DESKTOP_MODAL' });
        expect(getDesktopModalBackgroundPath(app.state)).toBeNull();
    });
    it('preserves the boundary through stale navigation-state rehydration', () => {
        const app = setup();
        app.send(StackActions.push('settings/index', { desktopModal: '1' }));
        app.send(StackActions.push('settings/appearance'));
        const router = createDesktopModalRouter({ initialRouteName: 'index' });
        const restored = router.getRehydratedState({ ...app.state, stale: true, routes: app.state.routes.map(({ state: nestedState, ...route }) => route) }, options);
        expect(getDesktopModalStart(restored)).toBe(1);
    });
});
