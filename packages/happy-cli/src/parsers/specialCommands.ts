/**
 * Parsers for special commands that require dedicated remote session handling
 */

export interface CompactCommandResult {
    isCompact: boolean;
    originalMessage: string;
}

export interface ClearCommandResult {
    isClear: boolean;
}

export interface SpecialCommandResult {
    type: SpecialCommandType | null;
    originalMessage?: string;
    goal?: GoalCommand;
    mcp?: McpCommand;
    usage?: UsageCommand;
    review?: ReviewCommand;
    plan?: PlanCommand;
}

export type SpecialCommandType =
    | 'compact'
    | 'clear'
    | 'mcp'
    | 'skills'
    | 'goal'
    | 'usage'
    | 'status'
    | 'diff'
    | 'new'
    | 'fork'
    | 'review'
    | 'plan';

export type GoalCommand =
    | { action: 'show' }
    | { action: 'set'; objective: string }
    | { action: 'clear' }
    | { action: 'pause' }
    | { action: 'resume' }
    | { action: 'edit' };

export type McpCommand = { verbose: boolean };

export type UsageCommand = { range: 'summary' | 'daily' | 'weekly' | 'cumulative' };

export type ReviewCommand = { instructions?: string };

export type PlanCommand = { prompt?: string };

/**
 * Parse /compact command
 * Matches messages starting with "/compact " or exactly "/compact"
 */
export function parseCompact(message: string): CompactCommandResult {
    const trimmed = message.trim();
    
    if (trimmed === '/compact') {
        return {
            isCompact: true,
            originalMessage: trimmed
        };
    }
    
    if (trimmed.startsWith('/compact ')) {
        return {
            isCompact: true,
            originalMessage: trimmed
        };
    }
    
    return {
        isCompact: false,
        originalMessage: message
    };
}

/**
 * Parse /clear command
 * Only matches exactly "/clear"
 */
export function parseClear(message: string): ClearCommandResult {
    const trimmed = message.trim();
    
    return {
        isClear: trimmed === '/clear'
    };
}

/**
 * Parse /goal command forms supported by Codex app-server.
 */
export function parseGoal(message: string): GoalCommand | null {
    const trimmed = message.trim();
    const lower = trimmed.toLowerCase();

    if (lower === '/goal') {
        return { action: 'show' };
    }

    if (!lower.startsWith('/goal ')) {
        return null;
    }

    const rest = trimmed.slice('/goal '.length).trim();
    const lowerRest = rest.toLowerCase();

    if (lowerRest === 'clear') {
        return { action: 'clear' };
    }
    if (lowerRest === 'pause') {
        return { action: 'pause' };
    }
    if (lowerRest === 'resume') {
        return { action: 'resume' };
    }
    if (lowerRest === 'edit') {
        return { action: 'edit' };
    }
    if (rest.length > 0) {
        return { action: 'set', objective: rest };
    }

    return { action: 'show' };
}

function parseExactCommand(trimmed: string, command: string): boolean {
    return trimmed.toLowerCase() === command;
}

function parseInlineCommand(trimmed: string, command: string): string | null {
    const lower = trimmed.toLowerCase();
    if (lower === command) {
        return '';
    }
    if (!lower.startsWith(`${command} `)) {
        return null;
    }
    return trimmed.slice(command.length + 1).trim();
}

/**
 * Unified parser for special commands
 * Returns the type of command and original message if applicable
 */
export function parseSpecialCommand(message: string): SpecialCommandResult {
    const compactResult = parseCompact(message);
    if (compactResult.isCompact) {
        return {
            type: 'compact',
            originalMessage: compactResult.originalMessage
        };
    }
    
    const clearResult = parseClear(message);
    if (clearResult.isClear) {
        return {
            type: 'clear'
        };
    }
    
    const trimmed = message.trim();
    const lower = trimmed.toLowerCase();
    if (lower === '/mcp') {
        return { type: 'mcp', mcp: { verbose: false } };
    }
    if (lower === '/mcp verbose') {
        return { type: 'mcp', mcp: { verbose: true } };
    }
    if (lower === '/skills') {
        return { type: 'skills' };
    }
    if (lower === '/usage') {
        return { type: 'usage', usage: { range: 'summary' } };
    }
    if (lower === '/usage daily' || lower === '/usage weekly' || lower === '/usage cumulative') {
        return {
            type: 'usage',
            usage: { range: lower.slice('/usage '.length) as UsageCommand['range'] },
        };
    }
    for (const exactCommand of ['/status', '/diff', '/new', '/fork'] as const) {
        if (parseExactCommand(trimmed, exactCommand)) {
            return { type: exactCommand.slice(1) as SpecialCommandType };
        }
    }
    const review = parseInlineCommand(trimmed, '/review');
    if (review !== null) {
        return {
            type: 'review',
            review: review.length > 0 ? { instructions: review } : { instructions: undefined },
        };
    }
    const plan = parseInlineCommand(trimmed, '/plan');
    if (plan !== null) {
        return {
            type: 'plan',
            plan: plan.length > 0 ? { prompt: plan } : { prompt: undefined },
        };
    }
    const goal = parseGoal(message);
    if (goal) {
        return {
            type: 'goal',
            originalMessage: message.trim(),
            goal,
        };
    }

    return {
        type: null
    };
}
