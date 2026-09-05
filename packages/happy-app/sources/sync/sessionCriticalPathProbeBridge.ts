export type SessionCriticalPathAppStage =
    | 'web.root.module_ready'
    | 'web.fonts.critical_ready'
    | 'web.crypto.ready'
    | 'web.credentials.ready'
    | 'web.route.mounted'
    | 'web.session.snapshot_started'
    | 'web.session.snapshot_completed'
    | 'web.messages.latest_started'
    | 'web.messages.latest_completed'
    | 'web.session.store_committed'
    | 'web.session.latest_message_painted'
    | 'web.session.route_painted'
    | 'web.spawn.clicked'
    | 'web.session.hydrated'
    | 'web.first_message.queued'
    | 'web.session.navigated'
    | 'web.processor.ready_received'
    | 'web.first_agent_event_received'
    | 'web.turn.completed';

type Probe = Record<string, unknown>;

const METHODS: Readonly<Record<SessionCriticalPathAppStage, string>> = {
    'web.root.module_ready': 'initFreshDeepLink',
    'web.fonts.critical_ready': 'markAppStage',
    'web.crypto.ready': 'markAppStage',
    'web.credentials.ready': 'markAppStage',
    'web.route.mounted': 'markFreshHeaderVisible',
    'web.session.snapshot_started': 'markAppStage',
    'web.session.snapshot_completed': 'markAppStage',
    'web.messages.latest_started': 'markAppStage',
    'web.messages.latest_completed': 'markAppStage',
    'web.session.store_committed': 'markAppStage',
    'web.session.latest_message_painted': 'markFreshLatestMessageComplete',
    'web.session.route_painted': 'markRouteNavigation',
    'web.spawn.clicked': 'startNewTextSession',
    'web.session.hydrated': 'markNewSessionEvent',
    'web.first_message.queued': 'markLocalQueue',
    'web.session.navigated': 'markAppStage',
    'web.processor.ready_received': 'markProcessorReady',
    'web.first_agent_event_received': 'markFirstAgentEvent',
    'web.turn.completed': 'markTurnCompletion',
};

export function markSessionCriticalPathAppStage(stage: SessionCriticalPathAppStage): boolean {
    try {
        const probe = (globalThis as { __happySessionCriticalPathProbe?: Probe }).__happySessionCriticalPathProbe;
        if (!probe || typeof probe !== 'object') return false;
        const method = METHODS[stage];
        const mark = method && probe[method];
        if (typeof mark !== 'function') return false;
        (mark as (value?: SessionCriticalPathAppStage) => void)(method === 'markAppStage' ? stage : undefined);
        return true;
    } catch {
        return false;
    }
}
