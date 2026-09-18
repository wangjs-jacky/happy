// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProfileEditor } from '../src/web/ProfileEditor.js';
import { createApi } from '../src/web/api.js';
afterEach(cleanup);
it('submits the selected robot and readable device using stable IDs without an avatar upload', async () => {
  let saved: unknown;
  const api = createApi(() => 'token', () => {}, async () => Response.json({ available: false, reason: 'no session' }), '');
  render(<ProfileEditor api={api} machines={[{ id: 'opaque', metadata: { host: 'jackyMac-mini.local' }, active: true } as never]} sessions={[]} onSave={async value => { saved = value; }}/>);
  fireEvent.change(screen.getByLabelText('Agent 名称'), { target: { value: '研究员' } });
  fireEvent.change(screen.getByLabelText('角色与关注点'), { target: { value: '查证资料' } });
  fireEvent.change(screen.getByLabelText('执行设备'), { target: { value: 'opaque' } });
  fireEvent.change(screen.getByLabelText('工作目录'), { target: { value: '/work' } });
  fireEvent.click(screen.getByRole('button', { name: '选择机器人' }));
  expect(screen.getAllByRole('button', { name: /机器人头像 \d/ })).toHaveLength(24);
  fireEvent.click(screen.getByRole('button', { name: '机器人头像 24' }));
  expect(document.querySelector('input[type=file]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '保存 Agent' }));
  await vi.waitFor(() => expect(saved).toMatchObject({ name: '研究员', instructions: '查证资料', avatarId: 23, machineId: 'opaque', directory: '/work', model: 'gpt-5.6-luna', effort: 'low' }));
});
