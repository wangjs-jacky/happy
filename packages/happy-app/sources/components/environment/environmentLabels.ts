import type { EnvironmentComponentId } from '@slopus/happy-wire';
import { t } from '@/text';
import type { EnvironmentCell } from '@/environment/environmentDashboard';

export function environmentComponentName(id: EnvironmentComponentId): string {
    switch (id) {
        case 'github-cli': return t('deviceEnvironment.githubCli');
        case 'paws-cli': return t('deviceEnvironment.pawsCli');
        case 'ego-browser': return t('deviceEnvironment.egoBrowser');
        case 'cloudflare-wrangler': return t('deviceEnvironment.cloudflareWrangler');
        case 'cloudflared': return t('deviceEnvironment.cloudflared');
    }
}
export const environmentIcons = { 'github-cli': 'logo-github', 'paws-cli': 'paw-outline', 'ego-browser': 'globe-outline', 'cloudflare-wrangler': 'cloud-outline', cloudflared: 'git-network-outline' } as const;

export function environmentReason(cell: EnvironmentCell): string | undefined {
    const o = cell.observation;
    if (o?.componentId === 'ego-browser' && o.details.kind === 'ego-browser' && o.support === 'supported') {
        if (!o.details.appVersion) return t('deviceEnvironment.egoAppMissing');
        if (!o.installed) return t('deviceEnvironment.egoCliMissing');
        if (!o.details.pathReady) return t('deviceEnvironment.egoPathMissing');
        if (!o.details.paired) return t('deviceEnvironment.egoMismatch');
    }
    const id = cell.componentId;
    switch (cell.reasonCode ?? o?.reasonCode) {
        case 'machine-offline': return t('deviceEnvironment.offlineRecovery');
        case 'unsupported-platform': case 'unsupported-architecture': return t('deviceEnvironment.componentUnsupported');
        case 'homebrew-missing': return t(id === 'cloudflared' ? 'deviceEnvironment.cloudflaredHomebrewMissing' : 'deviceEnvironment.homebrewMissing');
        case 'formula-unavailable': return t(id === 'cloudflared' ? 'deviceEnvironment.cloudflaredFormulaUnavailable' : 'deviceEnvironment.formulaUnavailable');
        case 'version-source-mismatch': return t(id === 'paws-cli' ? 'deviceEnvironment.pawsOwnershipMismatch' : 'deviceEnvironment.componentVersionSourceMismatch');
        case 'version-ahead': return t('deviceEnvironment.versionAhead');
        case 'authentication-missing': return t(id === 'github-cli' ? 'deviceEnvironment.authMissing' : id === 'cloudflared' ? 'deviceEnvironment.tunnelCertificateMissing' : 'deviceEnvironment.cloudflareAuthMissing');
        case 'operation-in-progress': return t('deviceEnvironment.operationInProgress');
        case 'plan-stale': return t('deviceEnvironmentDashboard.changed');
        case 'process-timeout': case 'rpc-timeout': return t('deviceEnvironment.componentTimeoutRecovery');
        case 'install-failed': case 'verification-failed': return t('deviceEnvironmentDashboard.failed');
        case 'unexpected-error': return t('deviceEnvironment.stateUnknown');
        case undefined: return undefined;
    }
}
