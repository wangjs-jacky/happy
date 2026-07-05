import { describe, expect, it, vi } from 'vitest';
import { getToolFullViewComponent } from './_all';

vi.mock('./EditView', () => ({ EditView: () => null }));
vi.mock('./BashView', () => ({ BashView: () => null }));
vi.mock('./WriteView', () => ({ WriteView: () => null }));
vi.mock('./TodoView', () => ({ TodoView: () => null }));
vi.mock('./ExitPlanToolView', () => ({ ExitPlanToolView: () => null }));
vi.mock('./MultiEditView', () => ({ MultiEditView: () => null }));
vi.mock('./TaskView', () => ({ TaskView: () => null }));
vi.mock('./BashViewFull', () => ({ BashViewFull: () => null }));
vi.mock('./EditViewFull', () => ({ EditViewFull: () => null }));
vi.mock('./MultiEditViewFull', () => ({ MultiEditViewFull: () => null }));
vi.mock('./CodexBashView', () => ({ CodexBashView: () => null }));
vi.mock('./CodexPatchView', () => ({ CodexPatchView: () => null }));
vi.mock('./CodexDiffView', () => ({ CodexDiffView: () => null }));
vi.mock('./AskUserQuestionView', () => ({ AskUserQuestionView: () => null }));
vi.mock('./GeminiEditView', () => ({ GeminiEditView: () => null }));
vi.mock('./GeminiExecuteView', () => ({ GeminiExecuteView: () => null }));
vi.mock('./FileView', () => ({ FileView: () => null }));

describe('tool full view registry', () => {
    it('uses Codex patch and diff views in tool detail screens', () => {
        expect(getToolFullViewComponent('CodexPatch')).not.toBeNull();
        expect(getToolFullViewComponent('CodexDiff')).not.toBeNull();
    });
});
