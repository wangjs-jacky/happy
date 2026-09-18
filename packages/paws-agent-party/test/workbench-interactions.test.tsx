// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { GroupChatApp } from '../src/web/GroupChatApp.js';

vi.mock('../src/web/lib/crypto.js', () => ({ decrypt: async (_key: string, text: string) => text }));
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); vi.unstubAllGlobals(); });

const members = [
  { id: 'pm', name: '产品经理', instructions: '关注需求', engine: 'codex', model: 'gpt-5.6-luna', effort: 'low', avatarId: 0, status: 'idle', machineId: 'mac', directory: '/work' },
  { id: 'eng', name: '工程师', instructions: '关注实现', engine: 'codex', model: 'gpt-5.6-luna', effort: 'low', avatarId: 1, status: 'idle', machineId: 'mac', directory: '/work' },
];
function setup() {
  sessionStorage.setItem('apToken', 'test-only');
  let rooms = ['one', 'two'].map(id => ({ id, partyId: id, title: `讨论 ${id}`, members, machineId: 'mac', directory: '/work', autoReply: true, autoDebate: false, maxRounds: 10, turns: [], createdAt: 1, updatedAt: 1 }));
  const sent: { path: string; body: any }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/events')) return new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } });
    if (init?.method === 'DELETE') { rooms = rooms.filter(room => !path.endsWith(`/${room.id}`)); return Response.json({ ok: true }); }
    if (init?.method === 'POST') { sent.push({ path, body: typeof init.body === 'string' ? JSON.parse(init.body) : null }); return Response.json({}); }
    if (path.endsWith('/status')) return Response.json({ state: 'disconnected' });
    if (path.endsWith('/agents')) return Response.json({ agents: members });
    if (path.endsWith('/rooms')) return Response.json({ rooms });
    if (path.includes('/messages')) return Response.json({ messages: [] });
    return Response.json({ key: 'key' });
  }));
  const rendered = render(<GroupChatApp/>);
  return { ...rendered, sent };
}

it('keeps members closed initially and exposes collapse and member actions', async () => {
  const { container } = setup();
  await screen.findByRole('heading', { name: '讨论 one' });
  expect(screen.queryByRole('complementary', { name: '本群成员' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '折叠侧栏' }));
  expect(container.querySelector('.group-workbench')?.classList.contains('sidebar-collapsed')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /成员 · 2/ }));
  expect(screen.getByRole('complementary', { name: '本群成员' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '邀请成员' })).toBeTruthy();
});

it('selects multiple mentions by keyboard and sends with Enter, not Shift+Enter', async () => {
  const { sent } = setup();
  const input = await screen.findByRole('textbox', { name: '群聊消息' });
  fireEvent.change(input, { target: { value: '@' } });
  expect(screen.getAllByRole('option')).toHaveLength(2);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect((input as HTMLTextAreaElement).value).toBe('@产品经理 ');
  expect(sent).toHaveLength(0);
  fireEvent.change(input, { target: { value: '@产品经理 @工' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect((input as HTMLTextAreaElement).value).toBe('@产品经理 @工程师 ');
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(sent).toHaveLength(0);
  fireEvent.keyDown(input, { key: 'Enter' });
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0].body.text).toBe('@产品经理 @工程师 ');
});

it('preserves independent drafts when switching rooms', async () => {
  setup();
  const input = await screen.findByRole('textbox', { name: '群聊消息' });
  fireEvent.change(input, { target: { value: '第一间草稿' } });
  const nav = within(screen.getByRole('navigation', { name: '我的群聊' }));
  fireEvent.click(nav.getByRole('button', { name: /讨论 two 2 位/ }));
  const second = screen.getByRole('textbox', { name: '群聊消息' });
  expect((second as HTMLTextAreaElement).value).toBe('');
  fireEvent.change(second, { target: { value: '第二间草稿' } });
  fireEvent.click(nav.getByRole('button', { name: /讨论 one 2 位/ }));
  expect((screen.getByRole('textbox', { name: '群聊消息' }) as HTMLTextAreaElement).value).toBe('第一间草稿');
});

it('requires confirmation before deleting and selects the surviving room', async () => {
  setup();
  await screen.findByRole('heading', { name: '讨论 one' });
  fireEvent.click(screen.getByRole('button', { name: '讨论 one 的更多操作' }));
  fireEvent.click(screen.getByRole('button', { name: '删除群聊' }));
  const confirmation = screen.getByRole('dialog', { name: '删除群聊' });
  expect(confirmation.textContent).toContain('远端');
  fireEvent.click(within(confirmation).getByRole('button', { name: '取消' }));
  expect(screen.getByRole('heading', { name: '讨论 one' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '讨论 one 的更多操作' }));
  fireEvent.click(screen.getByRole('button', { name: '删除群聊' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '删除群聊' })).getByRole('button', { name: '确认删除' }));
  expect(await screen.findByRole('heading', { name: '讨论 two' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '讨论 one 的更多操作' })).toBeNull();
});

it('offers a temporary member without writing to the reusable agent library', async () => {
  const { sent } = setup();
  await screen.findByRole('heading', { name: '讨论 one' });
  fireEvent.click(screen.getByRole('button', { name: /成员 · 2/ }));
  fireEvent.click(screen.getByRole('button', { name: '邀请成员' }));
  fireEvent.click(screen.getByRole('button', { name: '临时成员' }));
  expect(screen.getByText('只加入本群，不保存到我的 Agent。')).toBeTruthy();
  expect(screen.getByRole('button', { name: '创建并加入群聊' })).toBeTruthy();
  expect(sent).toHaveLength(0);
});
