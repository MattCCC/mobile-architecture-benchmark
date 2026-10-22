#import "MBBenchKitCore.h"

#import <UIKit/UIKit.h>
#import <mach/mach.h>
#import <notify.h>
#import <os/lock.h>
#import <os/log.h>
#import <os/signpost.h>
#import <sys/sysctl.h>
#import <sys/time.h>
#import <time.h>
#import <unistd.h>

// Markers: (event, ordinal, CLOCK_UPTIME_RAW ns, payload) appended to a pre-allocated ring buffer, plus an
// os_signpost event (Instruments). Driver-visible markers are also written as one public os_log line
// `MB <journeyId> <event> <n> <payload> t=<uptime ns> w=<wall us>` (PoC addition for pre-harness checks) and
// announced with a Darwin notification `org.example.mobilebench.<event>`; neither is a timing source.

static const NSInteger kRingCapacity = 4096;
static const NSInteger kRowPt = 72;

typedef struct {
  char event[25];
  int32_t n;
  uint64_t t;
  char payload[65];
} MBEntry;

@implementation MBBenchKitCore {
  os_unfair_lock _lock;
  MBEntry *_ring;
  NSInteger _written;
  NSInteger _flushed;
  BOOL _flushing;
  NSMutableDictionary<NSString *, NSNumber *> *_counts;
  NSDictionary<NSString *, NSString *> *_launch;
  NSString *_journeyId;
  BOOL _mirrorAll;
  NSSet<NSString *> *_controlSet;
  os_log_t _log;
  NSInteger _fgSeq;
  BOOL _fuiDone;
  double _listHeight;
  NSInteger _kReq;
  NSMutableSet<NSNumber *> *_drawnRows;
  BOOL _summaryDrawn;
  NSInteger _selectedCount;
  NSInteger _selectionRevision;
  NSInteger _navSeq;
  NSString *_navRoute;
  NSMutableDictionary<NSString *, NSString *> *_lastTokens;
}

+ (void)load
{
  // Process start: observers and the process anchor are installed before the app delegate runs.
  [MBBenchKitCore shared];
}

+ (instancetype)shared
{
  static MBBenchKitCore *core;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    core = [[MBBenchKitCore alloc] initPrivate];
  });
  return core;
}

- (instancetype)initPrivate
{
  if (self = [super init]) {
    _lock = OS_UNFAIR_LOCK_INIT;
    _ring = (MBEntry *)calloc(kRingCapacity, sizeof(MBEntry));
    _counts = [NSMutableDictionary new];
    _drawnRows = [NSMutableSet new];
    _lastTokens = [NSMutableDictionary new];
    _navRoute = @"list";
    _listHeight = -1;
    _controlSet = [NSSet setWithArray:@[
      @"fui", @"resume", @"restore", @"remote.ready", @"remote.error", @"state", @"err", @"a11y", @"launch",
      @"proc.anchor", @"ctr", @"mem"
    ]];
    _log = os_log_create("org.example.mobilebench", "markers");
    [self parseLaunchArguments];
    [self installObservers];
    [self markProcessAnchor];
  }
  return self;
}

#pragma mark - Launch configuration and lifecycle

- (void)parseLaunchArguments
{
  NSArray<NSString *> *args = NSProcessInfo.processInfo.arguments;
  NSMutableDictionary<NSString *, NSString *> *config = [NSMutableDictionary new];
  for (NSUInteger i = 0; i + 1 < args.count; i++) {
    NSString *a = args[i];
    if ([a hasPrefix:@"-mb."]) {
      config[[a substringFromIndex:1]] = args[i + 1];
      i++;
    }
  }
  _launch = config;
  NSString *journey = config[@"mb.journey"];
  NSRegularExpression *re = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9._-]{1,64}$" options:0 error:nil];
  if (journey != nil && [re numberOfMatchesInString:journey options:0 range:NSMakeRange(0, journey.length)] == 1) {
    _journeyId = journey;
  } else {
    _journeyId = @"-";
  }
  _mirrorAll = [config[@"mb.markerMirror"] isEqualToString:@"all"];
}

- (void)installObservers
{
  NSNotificationCenter *nc = NSNotificationCenter.defaultCenter;
  __weak MBBenchKitCore *weakSelf = self;
  [nc addObserverForName:UIApplicationDidEnterBackgroundNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification *note) {
                MBBenchKitCore *core = weakSelf;
                [core mark:@"bg" payload:[NSString stringWithFormat:@"fg=%ld", (long)[core fgSeq]]];
                [core flush];
              }];
  [nc addObserverForName:UIApplicationWillEnterForegroundNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification *note) {
                MBBenchKitCore *core = weakSelf;
                NSInteger fg = [core nextForeground];
                [core mark:@"fg" payload:[NSString stringWithFormat:@"fg=%ld", (long)fg]];
              }];
}

- (NSInteger)nextForeground
{
  os_unfair_lock_lock(&_lock);
  _fgSeq += 1;
  NSInteger fg = _fgSeq;
  os_unfair_lock_unlock(&_lock);
  return fg;
}

- (uint64_t)wallMicros
{
  struct timeval tv;
  gettimeofday(&tv, NULL);
  return (uint64_t)tv.tv_sec * 1000000ULL + (uint64_t)tv.tv_usec;
}

- (void)markProcessAnchor
{
  uint64_t startMicros = 0;
  struct kinfo_proc info;
  size_t size = sizeof(info);
  int mib[4] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()};
  if (sysctl(mib, 4, &info, &size, NULL, 0) == 0) {
    struct timeval st = info.kp_proc.p_starttime;
    startMicros = (uint64_t)st.tv_sec * 1000000ULL + (uint64_t)st.tv_usec;
  }
  [self mark:@"proc.anchor"
      payload:[NSString stringWithFormat:@"ws=%llu;ps=%llu", [self wallMicros], startMicros]];
}

- (NSString *)launchConfigJSON
{
  NSData *data = [NSJSONSerialization dataWithJSONObject:_launch ?: @{} options:0 error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"{}";
}

- (NSInteger)fgSeq
{
  os_unfair_lock_lock(&_lock);
  NSInteger fg = _fgSeq;
  os_unfair_lock_unlock(&_lock);
  return fg;
}

#pragma mark - Markers

- (NSString *)sanitize:(NSString *)payload
{
  NSMutableString *out = [NSMutableString stringWithCapacity:MIN(payload.length, 64)];
  for (NSUInteger i = 0; i < payload.length && out.length < 64; i++) {
    unichar c = [payload characterAtIndex:i];
    if (c >= 0x21 && c <= 0x7e && c != '|' && c != '"' && c != '\\') {
      [out appendFormat:@"%C", c];
    }
  }
  return out;
}

- (uint64_t)nowNs
{
  return clock_gettime_nsec_np(CLOCK_UPTIME_RAW);
}

- (uint64_t)mark:(NSString *)event payload:(NSString *)payload
{
  uint64_t t = clock_gettime_nsec_np(CLOCK_UPTIME_RAW);
  NSString *p = [self sanitize:payload ?: @""];
  os_unfair_lock_lock(&_lock);
  int32_t n = (int32_t)([_counts[event] integerValue] + 1);
  _counts[event] = @(n);
  MBEntry *e = &_ring[_written % kRingCapacity];
  strlcpy(e->event, event.UTF8String ?: "", sizeof(e->event));
  e->n = n;
  e->t = t;
  strlcpy(e->payload, p.UTF8String ?: "", sizeof(e->payload));
  _written += 1;
  BOOL needsFlush = !_flushing && (_written - _flushed) >= (kRingCapacity * 3) / 4;
  os_unfair_lock_unlock(&_lock);

  os_signpost_event_emit(_log, OS_SIGNPOST_ID_EXCLUSIVE, "mb", "%{public}s %d %{public}s", event.UTF8String, n, p.UTF8String);
  BOOL control = [_controlSet containsObject:event];
  if (_mirrorAll || control) {
    os_log(_log, "MB %{public}s %{public}s %d %{public}s t=%llu w=%llu", _journeyId.UTF8String, event.UTF8String, n,
           p.length > 0 ? p.UTF8String : "-", t, [self wallMicros]);
  }
  if (control) {
    NSString *name = [@"org.example.mobilebench." stringByAppendingString:event];
    notify_post(name.UTF8String);
  }
  if (needsFlush) {
    [self flush];
    [self mark:@"flush" payload:@"reason=buffer"];
  }
  return t;
}

- (NSInteger)count:(NSString *)event
{
  os_unfair_lock_lock(&_lock);
  NSInteger n = [_counts[event] integerValue];
  os_unfair_lock_unlock(&_lock);
  return n;
}

- (NSInteger)flush
{
  os_unfair_lock_lock(&_lock);
  if (_flushing) {
    os_unfair_lock_unlock(&_lock);
    return 0;
  }
  _flushing = YES;
  NSInteger from = MAX(_flushed, _written - kRingCapacity);
  NSInteger to = _written;
  NSMutableString *buf = [NSMutableString new];
  for (NSInteger k = from; k < to; k++) {
    MBEntry *e = &_ring[k % kRingCapacity];
    [buf appendFormat:@"{\"e\":\"%s\",\"n\":%d,\"t\":%llu,\"p\":\"%s\"}\n", e->event, e->n, e->t, e->payload];
  }
  _flushed = to;
  NSString *journey = _journeyId;
  os_unfair_lock_unlock(&_lock);

  if (buf.length > 0) {
    NSString *caches = NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES).firstObject;
    NSString *dir = [caches stringByAppendingPathComponent:@"mobilebench"];
    [NSFileManager.defaultManager createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
    NSString *path = [dir stringByAppendingPathComponent:[NSString stringWithFormat:@"markers-%@.jsonl", journey]];
    NSData *data = [buf dataUsingEncoding:NSUTF8StringEncoding];
    if (![NSFileManager.defaultManager fileExistsAtPath:path]) {
      [data writeToFile:path atomically:YES];
    } else {
      NSFileHandle *fh = [NSFileHandle fileHandleForWritingAtPath:path];
      [fh seekToEndOfFile];
      [fh writeData:data];
      [fh closeFile];
    }
  }
  os_unfair_lock_lock(&_lock);
  _flushing = NO;
  os_unfair_lock_unlock(&_lock);
  return to - from;
}

#pragma mark - Session, gate and tokens

- (void)rearmLocked
{
  _fuiDone = NO;
  _listHeight = -1;
  _kReq = 0;
  [_drawnRows removeAllObjects];
  _summaryDrawn = NO;
  _selectionRevision = 0;
  _navSeq = 0;
  _navRoute = @"list";
  [_lastTokens removeAllObjects];
}

- (void)sessionStart:(NSInteger)selectedCount
{
  os_unfair_lock_lock(&_lock);
  [self rearmLocked];
  _selectedCount = selectedCount;
  os_unfair_lock_unlock(&_lock);
}

- (NSInteger)selectionChanged:(NSInteger)selectedCount
{
  os_unfair_lock_lock(&_lock);
  _selectedCount = selectedCount;
  _selectionRevision += 1;
  NSInteger rev = _selectionRevision;
  os_unfair_lock_unlock(&_lock);
  return rev;
}

- (NSInteger)navStart:(NSString *)route
{
  os_unfair_lock_lock(&_lock);
  _navSeq += 1;
  _navRoute = [route copy];
  NSInteger nav = _navSeq;
  os_unfair_lock_unlock(&_lock);
  return nav;
}

- (NSString *)restoreToken:(NSString *)route anchor:(NSInteger)anchor
{
  return [NSString stringWithFormat:@"restore:%@:%ld", route, (long)anchor];
}

- (NSInteger)listLayout:(double)heightPt
{
  NSInteger h = (NSInteger)llround(heightPt);
  NSInteger k;
  os_unfair_lock_lock(&_lock);
  if (_listHeight >= 0) {
    k = _kReq;
    os_unfair_lock_unlock(&_lock);
    return k;
  }
  _listHeight = (double)h;
  _kReq = MAX(1, h / kRowPt);
  k = _kReq;
  os_unfair_lock_unlock(&_lock);
  [self mark:@"list.layout" payload:[NSString stringWithFormat:@"h=%ld;k=%ld", (long)h, (long)k]];
  [self checkGate];
  return k;
}

- (void)probeDrawn:(NSString *)kind index:(NSInteger)index token:(NSString *)token
{
  NSString *event = nil;
  NSString *payload = @"";
  os_unfair_lock_lock(&_lock);
  if ([kind isEqualToString:@"row"]) {
    if (_fuiDone || ![token isEqualToString:@"fui0"]) {
      os_unfair_lock_unlock(&_lock);
      return;
    }
    [_drawnRows addObject:@(index)];
  } else if ([kind isEqualToString:@"summary"]) {
    if ([token isEqualToString:@"fui0"]) {
      if (_fuiDone) {
        os_unfair_lock_unlock(&_lock);
        return;
      }
      _summaryDrawn = YES;
    } else if ([token hasPrefix:@"rev:"] && ![_lastTokens[@"summary"] isEqualToString:token]) {
      _lastTokens[@"summary"] = token;
      event = @"resp";
      payload = [NSString stringWithFormat:@"rev=%@;sel=%ld", [token substringFromIndex:4], (long)_selectedCount];
    } else {
      os_unfair_lock_unlock(&_lock);
      return;
    }
  } else if ([kind isEqualToString:@"screen"]) {
    NSString *key = [NSString stringWithFormat:@"screen:%ld", (long)index];
    if ([_lastTokens[key] isEqualToString:token]) {
      os_unfair_lock_unlock(&_lock);
      return;
    }
    _lastTokens[key] = token;
    if ([token hasPrefix:@"nav:"]) {
      event = @"screen";
      payload = [NSString stringWithFormat:@"r=%@;nav=%@", _navRoute, [token substringFromIndex:4]];
    } else if ([token hasPrefix:@"fg:"]) {
      event = @"resume";
      payload = [NSString stringWithFormat:@"r=%@;fg=%@", _navRoute, [token substringFromIndex:3]];
    } else if ([token hasPrefix:@"restore:"]) {
      NSArray<NSString *> *parts = [token componentsSeparatedByString:@":"];
      event = @"restore";
      payload = [NSString stringWithFormat:@"r=%@;a=%@", parts.count > 1 ? parts[1] : @"", parts.count > 2 ? parts[2] : @""];
    } else {
      os_unfair_lock_unlock(&_lock);
      return;
    }
  } else if ([kind isEqualToString:@"insights"]) {
    NSString *key = [NSString stringWithFormat:@"insights:%ld", (long)index];
    if (![token hasPrefix:@"ready:"] || [_lastTokens[key] isEqualToString:token]) {
      os_unfair_lock_unlock(&_lock);
      return;
    }
    _lastTokens[key] = token;
    NSArray<NSString *> *parts = [token componentsSeparatedByString:@":"];
    event = @"remote.ready";
    payload = [NSString stringWithFormat:@"v=%@", parts.count > 1 ? parts[1] : @""];
  } else {
    os_unfair_lock_unlock(&_lock);
    return;
  }
  os_unfair_lock_unlock(&_lock);
  if (event != nil) {
    [self mark:event payload:payload];
  } else {
    [self checkGate];
  }
}

- (void)checkGate
{
  NSString *payload = nil;
  os_unfair_lock_lock(&_lock);
  if (!_fuiDone && _kReq > 0 && _summaryDrawn) {
    BOOL all = YES;
    for (NSInteger i = 0; i < _kReq; i++) {
      if (![_drawnRows containsObject:@(i)]) {
        all = NO;
        break;
      }
    }
    if (all) {
      _fuiDone = YES;
      payload = [NSString stringWithFormat:@"rows=%ld;h=%ld;sel=%ld;seq=0", (long)_kReq, (long)llround(_listHeight),
                                           (long)_selectedCount];
    }
  }
  os_unfair_lock_unlock(&_lock);
  if (payload != nil) {
    [self mark:@"fui" payload:payload];
  }
}

#pragma mark - Checkpoints

- (void)publishState:(NSInteger)k seq:(NSInteger)seq digest:(NSString *)digest counters:(NSString *)counters
{
  NSString *d = digest.length > 16 ? [digest substringToIndex:16] : digest;
  [self mark:@"state" payload:[NSString stringWithFormat:@"k=%ld;s=%ld;d=%@", (long)k, (long)seq, d]];
  [self mark:@"ctr" payload:counters];
  [self flush];
}

- (NSString *)memoryCheckpoint:(NSString *)label
{
  task_vm_info_data_t info;
  mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
  if (task_info(mach_task_self(), TASK_VM_INFO, (task_info_t)&info, &count) != KERN_SUCCESS) {
    return @"";
  }
  uint64_t peak = count >= TASK_VM_INFO_REV3_COUNT ? (uint64_t)info.ledger_phys_footprint_peak : 0;
  NSString *payload = [NSString stringWithFormat:@"fp=%llu;pk=%llu", (uint64_t)info.phys_footprint, peak];
  [self mark:@"mem" payload:payload];
  return payload;
}

@end
