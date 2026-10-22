#import "MBBenchKit.h"
#import "MBBenchKitCore.h"

@implementation MBBenchKit

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
  return @((double)[[MBBenchKitCore shared] mark:event payload:payload]);
}

- (NSNumber *)nowNs
{
  return @((double)[[MBBenchKitCore shared] nowNs]);
}

- (NSNumber *)markerCount:(NSString *)event
{
  return @([[MBBenchKitCore shared] count:event]);
}

- (NSString *)launchConfig
{
  return [[MBBenchKitCore shared] launchConfigJSON];
}

- (NSNumber *)fgSeq
{
  return @([[MBBenchKitCore shared] fgSeq]);
}

- (NSNumber *)sessionStart:(double)selectedCount
{
  [[MBBenchKitCore shared] sessionStart:(NSInteger)selectedCount];
  return @1;
}

- (NSNumber *)selectionChanged:(double)selectedCount
{
  return @([[MBBenchKitCore shared] selectionChanged:(NSInteger)selectedCount]);
}

- (NSNumber *)navStart:(NSString *)route
{
  return @([[MBBenchKitCore shared] navStart:route]);
}

- (NSString *)restoreToken:(NSString *)route anchor:(double)anchor
{
  return [[MBBenchKitCore shared] restoreToken:route anchor:(NSInteger)anchor];
}

- (NSNumber *)listLayout:(double)height
{
  return @([[MBBenchKitCore shared] listLayout:height]);
}

- (NSNumber *)publishState:(double)k seq:(double)seq digest:(NSString *)digest counters:(NSString *)counters
{
  [[MBBenchKitCore shared] publishState:(NSInteger)k seq:(NSInteger)seq digest:digest counters:counters];
  return @1;
}

- (NSString *)memoryCheckpoint:(NSString *)label
{
  return [[MBBenchKitCore shared] memoryCheckpoint:label];
}

- (NSNumber *)flush
{
  return @([[MBBenchKitCore shared] flush]);
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
