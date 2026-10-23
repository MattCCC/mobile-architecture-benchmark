#import "MBIslandBench.h"

#import <time.h>

Class<MBHostBenchClass> _Nullable MBIslandHostBench(void)
{
  static Class cls = nil;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    cls = NSClassFromString(@"MBHostBench");
  });
  return (Class<MBHostBenchClass>)cls;
}

@implementation MBIslandBench

+ (NSString *)moduleName
{
  return @"MobileBenchKit";
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeMobileBenchKitSpecJSI>(params);
}

- (NSNumber *)mark:(NSString *)event payload:(NSString *)payload
{
  return @((double)[MBIslandHostBench() mark:event payload:payload]);
}

- (NSNumber *)nowNs
{
  Class<MBHostBenchClass> host = MBIslandHostBench();
  return @((double)(host != nil ? [host nowNs] : clock_gettime_nsec_np(CLOCK_UPTIME_RAW)));
}

- (NSNumber *)markerCount:(NSString *)event
{
  return @([MBIslandHostBench() count:event]);
}

- (NSString *)launchConfig
{
  NSString *json = [MBIslandHostBench() launchConfigJSON];
  return json ?: @"{}";
}

- (NSNumber *)fgSeq
{
  return @([MBIslandHostBench() fgSeq]);
}

// Session calls belong to the host's data layer; the island runtime only renders.
- (NSNumber *)sessionStart:(double)selectedCount
{
  return @1;
}

- (NSNumber *)selectionChanged:(double)selectedCount
{
  return @0;
}

- (NSNumber *)navStart:(NSString *)route
{
  return @0;
}

- (NSString *)restoreToken:(NSString *)route anchor:(double)anchor
{
  return [NSString stringWithFormat:@"restore:%@:%ld", route, (long)anchor];
}

- (NSNumber *)listLayout:(double)height
{
  return @0;
}

- (NSNumber *)publishState:(double)k seq:(double)seq digest:(NSString *)digest counters:(NSString *)counters
{
  return @1;
}

- (NSString *)memoryCheckpoint:(NSString *)label
{
  return @"";
}

- (NSNumber *)flush
{
  return @([MBIslandHostBench() flush]);
}

- (NSString *)echo:(NSString *)value
{
  return value;
}

- (void)echoAsync:(NSString *)value resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve(value);
}

@end
