// Restoration record persistence with AsyncStorage (design §14.3, RN family). AsyncStorage writes atomically
// (Android: SQLite transaction; iOS: file written atomically), which covers the temp-file + rename rule of §8.8.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Persistence } from './session';

const KEY = 'mobilebench.restoration.v2';

export const asyncStoragePersistence: Persistence = {
  load: () => AsyncStorage.getItem(KEY),
  save: (text) => AsyncStorage.setItem(KEY, text),
};
