// React contexts and hooks shared by the screens of every RN-family host.
import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import type { Session } from './session';
import type { ItemSnapshot, SelectionSnapshot } from '../domain/store';
import type { Observable } from '../domain/observable';

/** Navigation adapter provided by each host (expo-router, React Navigation, native shell). */
export interface NavAdapter {
  openSelection(): void;
  openDetail(index: number): void;
  openInsights(): void;
  back(): void;
  /** Current route stack, bottom first (`list`, `selection`, `detail/<i>`, `insights`). */
  routes(): string[];
}

export const SessionContext = createContext<Session | null>(null);
export const NavContext = createContext<NavAdapter | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (s === null) {
    throw new Error('SessionContext missing');
  }
  return s;
}

export function useNav(): NavAdapter {
  const n = useContext(NavContext);
  if (n === null) {
    throw new Error('NavContext missing');
  }
  return n;
}

export function useObservable<T>(o: Observable<T>): T {
  return useSyncExternalStore(o.subscribe, o.get, o.get);
}

export function useItem(index: number): ItemSnapshot {
  const { store } = useSession();
  const subscribe = useMemo(() => (cb: () => void) => store.subscribeItem(index, cb), [store, index]);
  const get = useMemo(() => () => store.getItem(index), [store, index]);
  return useSyncExternalStore(subscribe, get, get);
}

export function useSelectionSnapshot(): SelectionSnapshot {
  const { store } = useSession();
  const subscribe = useMemo(() => (cb: () => void) => store.subscribeSelection(cb), [store]);
  const get = useMemo(() => () => store.getSelection(), [store]);
  return useSyncExternalStore(subscribe, get, get);
}

export function useValuesVersion(): number {
  const { store } = useSession();
  const subscribe = useMemo(() => (cb: () => void) => store.subscribeValues(cb), [store]);
  const get = useMemo(() => () => store.getValuesVersion(), [store]);
  return useSyncExternalStore(subscribe, get, get);
}
