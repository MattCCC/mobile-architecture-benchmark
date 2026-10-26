import { Application, knownFolders, ListView } from '@nativescript/core';
import { entriesFromArguments } from '../core/launch-config';
import { FrameReader, TextFrameReader } from '../core/replay';

export const platformName = 'ios' as const;

// Numeric values of SDK constants (ambient const enums are not inlined by the transpile-only bundler build).
const CLOCK_UPTIME_RAW = 8;
const NS_UTF8_STRING_ENCODING = 4;
const NS_CACHES_DIRECTORY = 13;
const NS_APPLICATION_SUPPORT_DIRECTORY = 14;
const NS_USER_DOMAIN_MASK = 1;
const UITABLEVIEW_SEPARATOR_NONE = 0;

export function nowNs(): number {
  return clock_gettime_nsec_np(CLOCK_UPTIME_RAW as unknown as clockid_t);
}

export function traceMarker(_sectionName: string): void {
  // os_signpost is not reachable from JavaScript; signposts belong to the core BenchKit (Swift).
}

const stderrHandle = NSFileHandle.fileHandleWithStandardError;

/** App_Resources/iOS/src/MBLog.m: os_log into the unified log, where the runner reads the control lines. */
declare const MBLog: { line(line: string): void; anchorPayload(): string; memPayload(): string | null };

export function anchorPayload(): string | null {
  return String(MBLog.anchorPayload());
}

export function memPayload(): string | null {
  const p = MBLog.memPayload();
  return p ? String(p) : null;
}

export function logLine(line: string): void {
  MBLog.line(line);
  const data = NSString.stringWithString(`${line}\n`).dataUsingEncoding(NS_UTF8_STRING_ENCODING);
  if (data) {
    stderrHandle.writeData(data);
  }
}

export function controlSignal(event: string): void {
  notify_post(`org.example.mobilebench.${event}`);
}

export function launchEntries(_source: unknown): Record<string, string> {
  const args = NSProcessInfo.processInfo.arguments;
  const list: string[] = [];
  for (let i = 0; i < args.count; i += 1) {
    list.push(String(args.objectAtIndex(i)));
  }
  return entriesFromArguments(list);
}

export function keepScreenOn(_activity: unknown): void {
  UIApplication.sharedApplication.idleTimerDisabled = true;
}

export function reportFullyDrawn(_activity: unknown): void {
  // No iOS equivalent; the fui marker is the signal.
}

function ensureDir(path: string): string {
  const fm = NSFileManager.defaultManager;
  if (!fm.fileExistsAtPath(path)) {
    fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(path, true, null);
  }
  return path;
}

function userDir(directory: number): string {
  const urls = NSFileManager.defaultManager.URLsForDirectoryInDomains(
    directory as unknown as NSSearchPathDirectory,
    NS_USER_DOMAIN_MASK as unknown as NSSearchPathDomainMask,
  );
  return String(urls.objectAtIndex(0).path);
}

export function writeFileAtomically(path: string, text: string): boolean {
  try {
    // atomically: YES writes a temporary file and renames it over the target.
    return NSString.stringWithString(text).writeToFileAtomicallyEncodingError(path, true, NS_UTF8_STRING_ENCODING);
  } catch {
    return false;
  }
}

export function readTextFile(path: string): string | null {
  if (!NSFileManager.defaultManager.fileExistsAtPath(path)) {
    return null;
  }
  try {
    return String(NSString.stringWithContentsOfFileEncodingError(path, NS_UTF8_STRING_ENCODING));
  } catch {
    return null;
  }
}

export function appendTextFile(path: string, text: string): boolean {
  const fm = NSFileManager.defaultManager;
  if (!fm.fileExistsAtPath(path) && !fm.createFileAtPathContentsAttributes(path, null, null)) {
    return false;
  }
  const handle = NSFileHandle.fileHandleForWritingAtPath(path);
  const data = NSString.stringWithString(text).dataUsingEncoding(NS_UTF8_STRING_ENCODING);
  if (!handle || !data) {
    return false;
  }
  handle.seekToEndOfFile();
  handle.writeData(data);
  handle.closeFile();
  return true;
}

export function dataDir(): string {
  return ensureDir(`${userDir(NS_APPLICATION_SUPPORT_DIRECTORY)}/mobilebench`);
}

export function markerDir(): string | null {
  return ensureDir(`${userDir(NS_CACHES_DIRECTORY)}/mobilebench`);
}

export function openStreamReader(profile: string): FrameReader | null {
  // The bundler copies app/generated/stream/** into the app folder for iOS builds; read in place.
  const text = readTextFile(`${knownFolders.currentApp().path}/generated/stream/${profile}.stream.jsonl`);
  return text === null ? null : new TextFrameReader(text);
}

export function firstVisibleRow(listView: ListView): number {
  const tv = listView.ios as UITableView | undefined;
  const rows = tv ? tv.indexPathsForVisibleRows : null;
  if (!rows || rows.count === 0) {
    return 0;
  }
  let first = Number.MAX_SAFE_INTEGER;
  for (let k = 0; k < rows.count; k += 1) {
    first = Math.min(first, rows.objectAtIndex(k).row);
  }
  return first;
}

export function configureListView(listView: ListView): void {
  const tv = listView.ios as UITableView | undefined;
  if (tv) {
    tv.separatorStyle = UITABLEVIEW_SEPARATOR_NONE as unknown as UITableViewCellSeparatorStyle;
    tv.allowsSelection = false;
  }
}

export function a11yPayload(): string {
  const bit = (v: boolean): number => (v ? 1 : 0);
  return `vo=${bit(UIAccessibilityIsVoiceOverRunning())};sw=${bit(UIAccessibilityIsSwitchControlRunning())};sp=${bit(
    UIAccessibilityIsSpeakSelectionEnabled(),
  )}`;
}

export function watchA11y(_onChange: (payload: string) => void): void {
  // iOS reports the assistive-technology state once at process start (design §6.3).
}

let lifecycleWatched = false;

/** Background / foreground from the application notifications, delivered by @nativescript/core's iOS events. */
export function watchLifecycle(onBackground: () => void, onForeground: () => void): void {
  if (lifecycleWatched) {
    return;
  }
  lifecycleWatched = true;
  Application.on(Application.backgroundEvent, onBackground);
  Application.on(Application.foregroundEvent, onForeground);
}
