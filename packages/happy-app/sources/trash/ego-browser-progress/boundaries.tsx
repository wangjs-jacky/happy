import React from 'react';
import { Text, View } from 'react-native';
import { appThemes } from '@/themePacks';
import { zhHans } from '@/text/translations/zh-Hans';
export const theme = appThemes.ginghamDark;
export const StyleSheet = { hairlineWidth: 1, absoluteFillObject: {position:'absolute',left:0,right:0,top:0,bottom:0}, create: (fn: any) => fn(theme) };
export const useUnistyles = () => ({ theme });
export const Ionicons = ({ color, size }: any) => <Text aria-hidden style={{color,fontSize:size}}>◇</Text>;
export const t = (key: string, args: any) => { const value = key.split('.').reduce((o: any, k) => o?.[k], zhHans); return typeof value === 'function' ? value(args) : value ?? key; };
export const useSafeAreaInsets = () => ({ top:0,bottom:0,left:0,right:0 });
export const GestureHandlerRootView = View;
export function useAttachmentImage(sessionId: string, ref: string) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500"><rect width="900" height="500" fill="${sessionId==='session-a'?'#214459':'#49335b'}"/><text x="60" y="200" font-size="48" fill="white">${sessionId}</text><text x="60" y="290" font-size="32" fill="white">${ref}</text></svg>`;
    return {uri:'data:image/svg+xml,'+encodeURIComponent(svg),loading:false};
}
export const openSessionImageViewer = () => { throw Error('Browser gallery must stay in its own modal'); };
// Full image rendering/pagination is exercised by component tests, not this boundary fixture.
export function SessionImageViewer({ sources, initialIndex, onClose, paginate }: any) {
    return <View><Text testID="fixture-gallery-scope">{JSON.stringify({refs:sources.map((s:any)=>s.attachmentRef),paginate})}</Text><img alt="selected step" src={sources[initialIndex].uri}/><button onClick={onClose}>返回步骤</button></View>;
}
