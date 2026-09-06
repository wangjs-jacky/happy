import { it, expect, vi } from 'vitest';
const deleteImages = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('./relationshipAdvisorImageCache', () => ({ deleteAdvisorImages: deleteImages }));
import { loadLocalSettings, saveLocalSettings, clearPersistence } from './persistence';

it('cleans removed conversation originals while preserving images in other conversations', async () => {
    const settings = loadLocalSettings();
    const conversation = (id: string) => ({
        id, title: id, createdAt: 1, updatedAt: 1,
        messages: [{ id, role: 'user' as const, text: '', imageCount: 1, createdAt: 1, imageKeys: [`${id}.jpg`] }],
    });
    saveLocalSettings({ ...settings, relationshipAdvisorConversations: [conversation('keep'), conversation('remove')] });
    saveLocalSettings({ ...settings, relationshipAdvisorConversations: [conversation('keep')] });
    await vi.waitFor(() => expect(deleteImages).toHaveBeenCalledWith(['remove.jpg']));
    expect(loadLocalSettings().relationshipAdvisorConversations[0].messages[0].imageKeys).toEqual(['keep.jpg']);
    clearPersistence();
    await vi.waitFor(() => expect(deleteImages).toHaveBeenCalledWith(['keep.jpg']));
});
