import * as React from 'react';
import { SessionListViewItem, useSessionListViewData } from '@/sync/storage';

export function useVisibleSessionListViewData(): SessionListViewItem[] | null {
    const data = useSessionListViewData();

    return React.useMemo(() => {
        // Projects, Lists, and Timeline are all driven from this shared source.
        // Lifecycle archives belong exclusively to SessionHistoryList, so do not
        // expose archive rows, their date headers, or their visibility toggle here.
        return data?.filter((item) => item.type === 'active-sessions') ?? data;
    }, [data]);
}
