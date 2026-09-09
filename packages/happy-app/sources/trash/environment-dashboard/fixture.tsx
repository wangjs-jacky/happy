import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DeviceEnvironmentView } from '@/components/environment/DeviceEnvironmentView';
import { theme, toggleOffline } from './boundaries';
function Fixture() {
    const [open,setOpen] = useState(true);
    return <div style={{height:'100%',background:theme.colors.groupped.background,color:theme.colors.text,padding:24,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{position:'absolute',left:24,top:8,fontSize:11,color:theme.colors.textSecondary}}>受控验收 · 真实组件 / Hook / 队列，模拟 RPC，不执行安装</div>
        {!open ? <button data-testid="fixture-open" onClick={()=>setOpen(true)}>打开设备环境</button> : <div role="dialog" aria-modal="true" style={{width:'100%',maxWidth:1040,height:'100%',maxHeight:900,borderRadius:12,overflow:'hidden',background:theme.colors.surface,display:'flex',flexDirection:'column',boxShadow:'0 16px 44px #0005'}}>
            <div style={{minHeight:56,display:'flex',alignItems:'center',padding:'0 20px',borderBottom:`1px solid ${theme.colors.divider}`,gap:12}}>
                <span style={{flex:1,fontSize:17,fontWeight:600}}>设备环境</span>
                <button data-testid="fixture-offline" onClick={toggleOffline}>切换设备 3 在线状态</button>
                <button data-testid="fixture-close" aria-label="关闭弹窗" onClick={()=>setOpen(false)}>×</button>
            </div>
            <DeviceEnvironmentView />
        </div>}
    </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
