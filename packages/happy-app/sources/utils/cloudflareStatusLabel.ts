import { t } from '@/text';
import type { CloudflarePreviewStatus } from '@/sync/apiInteractivePreviews';

export function cloudflareStatusLabel(status: CloudflarePreviewStatus): string {
    if (!status.available) return t('interactivePreviews.unavailable');
    if (!status.connected) return t('delivery.unconfigured');
    switch (status.verification?.state) {
        case 'verified': return t(status.verification.source === 'publication' ? 'delivery.published' : 'delivery.verified');
        case 'authorization_error': return t('delivery.authorizationError');
        case 'unavailable': return t('delivery.verificationUnavailable');
        default: return t('delivery.unverified');
    }
}

