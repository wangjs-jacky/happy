export function getAgentSheetEntryState(input: {
    customAgentCount: number;
    builtinAgentCount: number;
}): { opensSheet: boolean; showsEmpty: boolean } {
    const total = input.customAgentCount + input.builtinAgentCount;
    return {
        opensSheet: total > 0,
        showsEmpty: total === 0,
    };
}
