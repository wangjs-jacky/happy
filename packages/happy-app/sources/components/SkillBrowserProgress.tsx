import * as React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { t } from '@/text';
import { BrowserProgressContext } from './BrowserProgressContext';
import { BrowserStepsPopover, type BrowserStepsAnchorRect } from './rightPanel/BrowserStepsPopover';

/** A sibling action, never nested inside the Skill diagnostic button. */
export function SkillBrowserProgress(props: { invocationMessageIds: string[] }) {
    const context = React.useContext(BrowserProgressContext);
    const dialogId = React.useId();
    const runs = React.useMemo(() => context?.runs.filter(run =>
        props.invocationMessageIds.includes(run.invocationMessageId)) ?? [],
    [context?.runs, props.invocationMessageIds]);
    const steps = React.useMemo(() => runs.flatMap(run => run.steps)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), [runs]);
    const [open, setOpen] = React.useState(false);
    const [anchor, setAnchor] = React.useState<BrowserStepsAnchorRect>();
    const triggerRef = React.useRef<View>(null);
    React.useEffect(() => { setOpen(false); }, [context?.sessionId]);

    if (!context?.sessionId || steps.length === 0) return null;
    return <>
        <View style={styles.actions}>
            <Pressable
                ref={triggerRef}
                testID="browser-progress-trigger"
                accessibilityRole="button"
                accessibilityLabel={t('rightPanelCapabilityHub.browserProgress.viewCount', { count: steps.length })}
                accessibilityState={{ expanded: open }}
                aria-expanded={open}
                aria-controls={dialogId}
                onPress={() => {
                    setAnchor(undefined);
                    // Open synchronously; measurement only adjusts placement.
                    setOpen(true);
                    if (Platform.OS === 'web') triggerRef.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
                }}
                style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            >
                <Text style={styles.label}>
                    {t('rightPanelCapabilityHub.browserProgress.viewCount', { count: steps.length })}
                </Text>
            </Pressable>
        </View>
        {open ? <BrowserStepsPopover
            key={context.sessionId}
            open
            dialogId={dialogId}
            sessionId={context.sessionId}
            steps={steps}
            anchor={anchor}
            onClose={() => setOpen(false)}
            returnFocusRef={triggerRef}
        /> : null}
    </>;
}

const styles = StyleSheet.create(theme => ({
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, flexShrink: 1 },
    button: { paddingHorizontal: 7, paddingVertical: 3, minHeight: 26, borderRadius: 5, justifyContent: 'center', backgroundColor: theme.colors.surface },
    pressed: { backgroundColor: theme.colors.surfacePressed },
    label: { fontSize: 12, lineHeight: 18, color: theme.colors.text },
}));
