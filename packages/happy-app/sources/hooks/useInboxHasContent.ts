import { useUpdates } from './useUpdates';
import { useCodexAttachCandidateInbox } from './useCodexAttachCandidateInbox';

// Hook to check if inbox has content to show
export function useInboxHasContent(): boolean {
    const { updateAvailable } = useUpdates();
    const codexCandidates = useCodexAttachCandidateInbox();

    // Show dot if there's any actionable content:
    // - App updates available
    // - Sessions available to attach
    return updateAvailable
        || codexCandidates.candidates.length > 0;
}
