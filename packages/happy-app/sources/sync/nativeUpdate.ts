import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import { checkNativeAppUpdate } from './apiNativeUpdate';
import { getServerUrl } from './serverConfig';
import { storage } from './storage';

export async function refreshNativeUpdateStatus() {
    const serverUrl = getServerUrl();
    try {
        const result = await checkNativeAppUpdate(serverUrl, {
            platform: Platform.OS,
            appId: Application.applicationId,
            version: Application.nativeApplicationVersion,
            runtimeVersion: Updates.runtimeVersion,
            channel: Updates.channel,
        });
        // Do not apply a late result from the previously selected server.
        if (getServerUrl() !== serverUrl) throw new Error('Server changed while checking updates');
        storage.getState().applyNativeUpdateStatus(result);
        return result;
    } catch (error) {
        if (getServerUrl() === serverUrl) storage.getState().applyNativeUpdateStatus(null);
        throw error;
    }
}
