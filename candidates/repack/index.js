/**
 * Entry of the `repack` host bundle (Re.Pack / Rspack).
 * ScriptManager persists the downloaded-script cache metadata in AsyncStorage, so a remote module downloaded once
 * is reused after a restart (cached remote load, scenario C3) until the cache is invalidated.
 */
import { ScriptManager } from '@callstack/repack/client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

ScriptManager.shared.setStorage(AsyncStorage);

AppRegistry.registerComponent(appName, () => App);
