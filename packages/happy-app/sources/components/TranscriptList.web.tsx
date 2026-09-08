import * as React from 'react';
import type { FlatList, FlatListProps } from 'react-native';
// Import the Web export explicitly: Unistyles rewrites react-native imports to
// function wrappers, which do not expose the pinned virtualizer class statics.
// @ts-expect-error react-native-web does not ship this export's declarations
import VirtualizedList from 'react-native-web/dist/exports/VirtualizedList';
import { createAnchoredWebVirtualizedList } from './anchoredWebVirtualizedList';

const AnchoredList = createAnchoredWebVirtualizedList(VirtualizedList);
const getItem = (data: unknown[], index: number) => data[index];
const getItemCount = (data: unknown[] | undefined) => data?.length ?? 0;

/** Transcript-only, single-column FlatList contract; native resolves the sibling file. */
export const TranscriptList = React.forwardRef((props: any, ref: any) =>
    <AnchoredList {...props} style={[props.style, { overflowAnchor: 'none' }]} ref={ref} getItem={getItem} getItemCount={getItemCount} />) as
    <Item>(props: FlatListProps<Item> & { ref?: React.Ref<FlatList<Item>> }) => React.ReactElement;
