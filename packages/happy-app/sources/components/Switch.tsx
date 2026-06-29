import { Platform, Switch as RNSwitch, SwitchProps } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Deferred } from './Deferred';
import { hapticsSelection } from './haptics';

export const Switch = (props: SwitchProps) => {
    const { theme } = useUnistyles();
    const { onValueChange, ...rest } = props;
    const handleValueChange = (value: boolean) => {
        hapticsSelection();
        onValueChange?.(value);
    };
    return (
        <Deferred enabled={Platform.OS === 'android'}>
            <RNSwitch
                {...rest}
                onValueChange={handleValueChange}
                trackColor={{ false: theme.colors.switch.track.inactive, true: theme.colors.switch.track.active }}
                ios_backgroundColor={theme.colors.switch.track.inactive}
                thumbColor={theme.colors.switch.thumb.active}
                {...{
                    activeThumbColor: theme.colors.switch.thumb.active,
                }}
            />
        </Deferred>
    );
}