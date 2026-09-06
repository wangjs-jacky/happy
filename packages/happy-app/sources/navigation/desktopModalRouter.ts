import { StackRouter, type ParamListBase, type StackNavigationState, type StackRouterOptions } from '@react-navigation/native';

type ModalState = StackNavigationState<ParamListBase> & { desktopModalBaseKey?: string };

/** The boundary is a route identity: duplicate paths cannot change the background. */
export function getDesktopModalStart(state: StackNavigationState<ParamListBase>): number {
    const baseKey = (state as ModalState).desktopModalBaseKey;
    const baseIndex = baseKey ? state.routes.findIndex(route => route.key === baseKey) : -1;
    return baseIndex >= 0 && baseIndex < state.index ? baseIndex + 1 : -1;
}

type NestedState = { index?: number; desktopModalBaseKey?: string; routes: readonly { key?: string; name: string; params?: object; state?: NestedState }[] };

/** Read the background route from the same navigation snapshot as usePathname. */
export function getDesktopModalBackgroundPath(state: NestedState | undefined): string | null {
    if (!state) return null;
    const baseIndex = state.desktopModalBaseKey ? state.routes.findIndex(route => route.key === state.desktopModalBaseKey) : -1;
    if (baseIndex >= 0 && baseIndex < (state.index ?? 0)) {
        const route = state.routes[baseIndex];
        const params = (route.params ?? {}) as Record<string, unknown>;
        const name = route.name.replace(/\[([^\]]+)\]/g, (_, key: string) => encodeURIComponent(String(params[key] ?? '')));
        return '/' + name.replace(/(^|\/)index$/, '').replace(/\/$/, '');
    }
    return getDesktopModalBackgroundPath(state.routes[state.index ?? 0]?.state);
}

export function createDesktopModalRouter(options: StackRouterOptions) {
    const original = StackRouter(options);
    return {
        ...original,
        getRehydratedState(partialState: Parameters<typeof original.getRehydratedState>[0], config: Parameters<typeof original.getRehydratedState>[1]): ModalState {
            const restored = { ...original.getRehydratedState(partialState, config), desktopModalBaseKey: (partialState as ModalState).desktopModalBaseKey };
            if (getDesktopModalStart(restored) < 0) restored.desktopModalBaseKey = undefined;
            return restored;
        },
        getStateForAction(state: ModalState, action: Parameters<typeof original.getStateForAction>[1], config: Parameters<typeof original.getStateForAction>[2]): ModalState | null {
            const start = getDesktopModalStart(state);
            if ((action.type as string) === 'CLOSE_DESKTOP_MODAL') {
                if (start < 0) return state;
                return { ...state, routes: state.routes.slice(0, start), index: start - 1, desktopModalBaseKey: undefined };
            }
            const payload = 'payload' in action ? action.payload : undefined;
            const params = payload && 'params' in payload ? payload.params as Record<string, unknown> | undefined : undefined;
            const opensModal = params?.desktopModal === '1';
            let nextAction = action;
            if (start >= 0 && action.type === 'POP') {
                nextAction = { ...action, payload: { ...action.payload, count: Math.min(action.payload.count, state.index - start + 1) } };
            }
            if (opensModal) {
                const { desktopModal: _marker, ...routeParams } = params;
                nextAction = { ...action, payload: { ...payload, params: routeParams } } as typeof action;
            }

            // Run forward/reset navigation on the modal's own slice. Even navigate('/')
            // and the session launcher's dismissTo('/') cannot consume the background.
            const scoped = start >= 0 && !['GO_BACK', 'POP'].includes(action.type);
            const activeState = scoped
                ? { ...state, routes: state.routes.slice(start), index: state.index - start }
                : state;
            const resolved = original.getStateForAction(activeState, nextAction, config);
            if (!resolved) return null;
            const next = resolved.stale === false ? resolved : original.getRehydratedState(resolved, config);
            const result: ModalState = scoped
                ? { ...next, routes: [...state.routes.slice(0, start), ...next.routes], index: start + next.index }
                : { ...next };
            result.desktopModalBaseKey = start >= 0
                ? state.desktopModalBaseKey
                : opensModal ? state.routes[state.index]?.key : undefined;
            if (getDesktopModalStart(result) < 0) result.desktopModalBaseKey = undefined;
            return result;
        },
    };
}
