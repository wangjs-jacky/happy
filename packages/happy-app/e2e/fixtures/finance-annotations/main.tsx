import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { FinanceChartCard } from '../../../sources/components/FinanceChartCard';
import { parseFinanceChartSection } from '../../../sources/utils/sessionFinanceCharts';
import { theme } from './theme';
const raw = {
 symbol:'TEST',name:'教学标注 · 合成测试数据',range:'5 bars',interval:'1m',asOf:'2026-10-07',source:'Synthetic test fixture — not market data',
 latest:{date:'09:35',close:102,change:0,changePercent:0},
 points:[
 {date:'09:31',open:103,high:105,low:102,close:104,volume:100},
 {date:'09:32',open:104,high:108,low:103,close:105,volume:200},
 {date:'09:33',open:105,high:106,low:100,close:101,volume:300},
 {date:'09:34',open:101,high:103,low:98,close:102,volume:400},
 {date:'09:35',open:102,high:104,low:101,close:102,volume:500}],
 numberedBars:true,
 annotations:[
 {type:'region',from:0,to:2,label:'前三根：分型范围示意'},
 {type:'point',at:{index:1,price:108},label:'第 2 根高点：108'},
 {type:'point',at:{index:3,price:98},label:'第 4 根低点：98'},
 {type:'line',from:{index:1,price:108},to:{index:3,price:98},dashed:true,label:'候选连线：仅展示端点关系，不代表已成立的笔'}]
};
const legacy = new URLSearchParams(location.search).get('case') === 'legacy';
const chart = parseFinanceChartSection(JSON.stringify({...raw,...(legacy?{annotations:[],numberedBars:false}:{})}))!;
document.body.style.cssText=`margin:0;background:${theme.colors.groupped.background};color:${theme.colors.text};font-family:system-ui`;
createRoot(document.getElementById('root')!).render(<GestureHandlerRootView style={{flex:1}}>
 <main style={{width:'100%',minWidth:0,maxWidth:760,margin:'0 auto',padding:16}}>
 <h2>Paws K 线组件验收</h2><p>合成测试数据 · 实际组件与手势库</p>
 <nav style={{display:'flex',gap:16,marginBottom:20}}>
 <a style={{color:theme.colors.textLink}} href="?theme=light">浅色标注</a><a style={{color:theme.colors.textLink}} href="?theme=dark">深色标注</a><a style={{color:theme.colors.textLink}} href="?theme=dark&case=legacy">旧卡片</a></nav>
 <section id="chart"><FinanceChartCard chart={chart}/></section>
 <p>验收：点击第 2 根应显示 09:32 / High 108；拖动到第 4 根应显示 09:34 / Low 98。</p>
 <div style={{height:500}} />
 </main>
</GestureHandlerRootView>);
