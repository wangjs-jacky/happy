import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserProgressContext } from '@/components/BrowserProgressContext';
import { ConversationActivityStrip } from '@/components/ConversationActivityStrip';
import { getBrowserStepRuns, hideLinkedBrowserSteps } from '@/components/rightPanel/browserStepRunsModel';
import type { Message } from '@/sync/typesMessage';

function frame(id: string, runId: string, label: string, time: number): Message {
    return {kind:'tool-call',id,createdAt:time,localId:null,children:[],tool:{name:'file',state:'completed',createdAt:time,startedAt:time,completedAt:time,description:null,input:{source:'browser_step',ref:id,name:id+'.png',image:{width:900,height:500},browserStep:{label,runId,skillName:'ego-browser'}}}};
}
function App() {
    const [sessionId,setSession]=React.useState('session-a');
    const [extra,setExtra]=React.useState(false);
    const prefix=sessionId==='session-a'?'A':'B';
    const messages=[frame(prefix+'-open','run-1',prefix+' · 已打开页面',1),frame(prefix+'-other','run-2',prefix+' · 另一任务结果',2),frame(prefix+'-done','run-1',prefix+' · 已核验结果',3),...(extra?[frame(prefix+'-followup','run-1',prefix+' · 后续关键步骤',4)]:[])];
    const runs=getBrowserStepRuns(messages);
    return <main style={{maxWidth:880,padding:24,margin:'0 auto'}}>
        <h1>Ego 关键步骤 · Skills 回归</h1><p>受控夹具：真实 Skills 栏与步骤弹窗；合成会话和图片。</p>
        <button data-testid="switch-session" onClick={()=>setSession(sessionId==='session-a'?'session-b':'session-a')}>切换会话</button>
        <button data-testid="add-step" onClick={()=>setExtra(true)}>追加同任务步骤</button>
        <p data-testid="current-session">{sessionId}</p>
        <BrowserProgressContext.Provider value={{sessionId,runs}}>
            <ConversationActivityStrip messages={hideLinkedBrowserSteps(messages,runs)}/>
        </BrowserProgressContext.Provider>
        <p data-testid="ordinary-chat">正文保持简洁，步骤图片只在 Skills 入口查看。</p>
    </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
