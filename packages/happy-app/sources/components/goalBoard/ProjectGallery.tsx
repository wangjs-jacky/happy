import * as React from 'react';
import { Modal, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { GoalProject } from '@slopus/happy-wire';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { GoalBoardButton } from './GoalBoardButton';
import type { ProjectLibraryEntry } from '@/sync/projectLibrary';

export function projectGalleryColumns(width: number) {
    return Math.max(1, Math.min(5, Math.floor((width + 20) / 280)));
}

// Original V2/V2.2 project artwork, bundled locally so cards do not need a third-party image service.
const covers = [
    require('@/assets/images/project-goals/paws.jpg'),
    require('@/assets/images/project-goals/creative.jpg'),
    require('@/assets/images/project-goals/harness.jpg'),
    require('@/assets/images/project-goals/mini.jpg'),
];
function coverFor(project: GoalProject) {
    if (/happy|paws/i.test(project.title)) return covers[0];
    let hash = 0;
    for (const char of project.projectPath.split('/').pop() || project.title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return covers[1 + hash % (covers.length - 1)];
}

function useGalleryLayout() {
    const [width, setWidth] = React.useState(0);
    const columns = projectGalleryColumns(width);
    const cardWidth = width ? (width - (columns - 1) * 20) / columns : 260;
    // Let CSS size web columns inside the actual scrollbar-adjusted content box.
    // onLayout can report the pre-scrollbar width during first mount.
    const gridStyle = Platform.OS === 'web' ? { display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } as any : null;
    return { cardWidth: Platform.OS === 'web' ? '100%' as const : cardWidth, setWidth, gridStyle };
}

export function ProjectGalleryLoading() {
    const { cardWidth, setWidth, gridStyle } = useGalleryLayout();
    return <View style={[styles.grid, gridStyle]} onLayout={event => setWidth(Math.floor(event.nativeEvent.layout.width))}>
        {Array.from({ length: 10 }, (_, index) => <View key={index} style={{ width: cardWidth, maxWidth: '100%' }}>
            <View style={[styles.cover, styles.skeleton]} />
            <View style={styles.caption}><View style={[styles.skeletonLine, { width: '72%' }]} /><View style={[styles.skeletonLine, { width: '90%' }]} /></View>
        </View>)}
    </View>;
}

export function ProjectGallery({ projects, onSelect, preferences = {}, onFavorite, onArchive, onDelete, onRestore }: {
    projects: GoalProject[]; onSelect: (project: GoalProject) => void;
    preferences?: Record<string, ProjectLibraryEntry>;
    onFavorite?: (project: GoalProject) => void; onArchive?: (project: GoalProject) => void;
    onDelete?: (project: GoalProject) => void; onRestore?: (project: GoalProject) => void;
}) {
    const { theme } = useUnistyles();
    const { cardWidth, setWidth, gridStyle } = useGalleryLayout();
    return <View style={[styles.grid, gridStyle]} onLayout={event => setWidth(Math.floor(event.nativeEvent.layout.width))} testID="project-gallery">
        {projects.map((project, index) => <View key={project.projectPath} style={{ width: cardWidth, maxWidth: '100%' }}>
            <GoalBoardButton variant="card" label={project.title} onPress={() => onSelect(project)} testID={`project-cover-${index}`}>
                <View style={styles.cover}>
                    <Image source={coverFor(project)} contentFit="cover" style={StyleSheet.absoluteFillObject} accessibilityLabel={project.title} />
                    <View style={styles.coverTop}><Text style={styles.coverNumber}>GOAL FIRST / {String(index + 1).padStart(2, '0')}</Text></View>
                    <View style={styles.coverFooter}><Text style={styles.coverLabel}>{project.features.length ? `${project.features.length} ${t('projectGoals.subprojects')}` : t('projectGoals.directTasks')}</Text><Ionicons name="arrow-forward" size={16} color={theme.colors.text} /></View>
                </View>
                <View style={styles.caption}>
                    <Text numberOfLines={1} style={styles.title}>{project.title}</Text>
                    <Text numberOfLines={2} style={styles.description}>{project.summary || project.features.map(feature => feature.title).slice(0, 3).join(' · ') || t('projectGoals.directTasks')}</Text>
                </View>
            </GoalBoardButton>
            <View style={styles.actions}>
                {onFavorite && preferences[project.projectPath]?.state !== 'deleted' && <GoalBoardButton label={t(preferences[project.projectPath]?.favorite ? 'projectGoals.unfavoriteProject' : 'projectGoals.favoriteProject')} selected={preferences[project.projectPath]?.favorite} onPress={() => onFavorite(project)} testID={`project-favorite-${index}`}><Ionicons name={preferences[project.projectPath]?.favorite ? 'star' : 'star-outline'} size={17} color={preferences[project.projectPath]?.favorite ? theme.colors.textLink : theme.colors.text} /></GoalBoardButton>}
                {onArchive && onDelete && onRestore && <ProjectCardMenu project={project} state={preferences[project.projectPath]?.state ?? 'active'} onArchive={() => onArchive(project)} onDelete={() => onDelete(project)} onRestore={() => onRestore(project)} index={index} />}
            </View>
        </View>)}
    </View>;
}

function ProjectCardMenu({ project, state, onArchive, onDelete, onRestore, index }: { project: GoalProject; state: ProjectLibraryEntry['state']; onArchive: () => void; onDelete: () => void; onRestore: () => void; index: number }) {
    const { theme } = useUnistyles();
    const { width, height } = useWindowDimensions();
    const trigger = React.useRef<View>(null);
    const first = React.useRef<View>(null);
    const [anchor, setAnchor] = React.useState<{ x: number; y: number } | null>(null);
    const close = React.useCallback(() => { setAnchor(null); queueMicrotask(() => trigger.current?.focus()); }, []);
    React.useEffect(() => {
        if (!anchor || Platform.OS !== 'web') return;
        const key = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
        };
        window.addEventListener('keydown', key, true);
        return () => window.removeEventListener('keydown', key, true);
    }, [anchor, close]);
    const menuWidth = Math.min(240, width - 24);
    return <>
        <GoalBoardButton ref={trigger} label={t('projectGoals.projectActions', { title: project.title })} expanded={!!anchor} testID={`project-more-${index}`} onPress={() => trigger.current?.measureInWindow((x, y, w, h) => setAnchor({ x: x + w, y: y + h }))}><Ionicons name="ellipsis-horizontal" size={17} color={theme.colors.text} /></GoalBoardButton>
        {anchor && <Modal transparent visible animationType="none" onRequestClose={close} onShow={() => first.current?.focus()}>
            <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={close} />
            <View style={[styles.menu, { width: menuWidth, left: Math.max(12, Math.min(anchor.x - menuWidth, width - menuWidth - 12)), top: Math.max(12, Math.min(anchor.y + 6, height - 190)) }]} testID="project-card-menu">
                <Text style={styles.menuTitle} numberOfLines={1}>{project.title}</Text>
                <GoalBoardButton ref={first} variant="row" label={t(state === 'active' ? 'projectGoals.archiveProject' : 'projectGoals.restoreProject')} onPress={() => { close(); if (state === 'deleted') onRestore(); else onArchive(); }} testID="project-menu-archive"><Ionicons name={state === 'active' ? 'archive-outline' : 'arrow-undo-outline'} size={17} color={theme.colors.text} /><Text style={styles.menuText}>{t(state === 'active' ? 'projectGoals.archiveProject' : 'projectGoals.restoreProject')}</Text></GoalBoardButton>
                {state !== 'deleted' && <GoalBoardButton variant="row" label={t('projectGoals.deleteProject')} onPress={() => { close(); onDelete(); }} testID="project-menu-delete"><Ionicons name="trash-outline" size={17} color={theme.colors.textDestructive} /><Text style={[styles.menuText, { color: theme.colors.textDestructive }]}>{t('projectGoals.deleteProject')}</Text></GoalBoardButton>}
            </View>
        </Modal>}
    </>;
}

const styles = StyleSheet.create(theme => ({
    grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 20, width: '100%' },
    skeleton: { backgroundColor: theme.colors.surfaceSelected },
    skeletonLine: { height: 12, borderRadius: 6, backgroundColor: theme.colors.surfaceSelected },
    cover: { width: '100%', aspectRatio: 16 / 9, backgroundColor: theme.colors.surfaceHigh, borderRadius: 13, overflow: 'hidden', justifyContent: 'space-between', padding: 12 },
    coverTop: { alignSelf: 'flex-start', backgroundColor: theme.colors.surface, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6 },
    coverNumber: { color: theme.colors.textSecondary, fontSize: 8, letterSpacing: 1, ...Typography.default('semiBold') },
    coverFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'flex-start', gap: 20, backgroundColor: theme.colors.surface, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 7 },
    coverLabel: { color: theme.colors.text, fontSize: 11, ...Typography.default() },
    caption: { paddingHorizontal: 4, paddingTop: 11, paddingBottom: 12, gap: 5 },
    title: { fontSize: 14, lineHeight: 21, color: theme.colors.text, ...Typography.default('semiBold') },
    description: { minHeight: 36, fontSize: 12, lineHeight: 18, color: theme.colors.textSecondary, ...Typography.default() },
    actions: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', gap: 5 },
    menu: { position: 'absolute', padding: 6, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface, shadowColor: theme.colors.shadow.color, shadowOpacity: theme.colors.shadow.opacity, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
    menuTitle: { paddingHorizontal: 12, paddingVertical: 10, fontSize: 12, color: theme.colors.textSecondary, ...Typography.default('semiBold') },
    menuText: { flexShrink: 1, fontSize: 13, lineHeight: 20, color: theme.colors.text, ...Typography.default() },
}));
