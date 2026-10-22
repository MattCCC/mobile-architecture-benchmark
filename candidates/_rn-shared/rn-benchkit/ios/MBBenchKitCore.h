// iOS BenchKit core of the RN wrapper (design §6.1-§6.3). Stand-in until the shared core
// (instrumentation/ios-benchkit) exists; the TurboModule and the probe then forward to it unchanged.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface MBBenchKitCore : NSObject

+ (instancetype)shared;

/// Records a marker in the ring buffer (CLOCK_UPTIME_RAW ns); returns the timestamp.
- (uint64_t)mark:(NSString *)event payload:(NSString *)payload;
- (uint64_t)nowNs;
- (NSInteger)count:(NSString *)event;
- (NSString *)launchConfigJSON;
- (NSInteger)fgSeq;
- (void)sessionStart:(NSInteger)selectedCount;
- (NSInteger)selectionChanged:(NSInteger)selectedCount;
- (NSInteger)navStart:(NSString *)route;
- (NSString *)restoreToken:(NSString *)route anchor:(NSInteger)anchor;
/// List container height in pt; returns kReq.
- (NSInteger)listLayout:(double)heightPt;
- (void)probeDrawn:(NSString *)kind index:(NSInteger)index token:(NSString *)token;
- (void)publishState:(NSInteger)k seq:(NSInteger)seq digest:(NSString *)digest counters:(NSString *)counters;
- (NSString *)memoryCheckpoint:(NSString *)label;
/// Appends unflushed buffer entries to Library/Caches/mobilebench/markers-<journeyId>.jsonl; returns the count.
- (NSInteger)flush;

@end

NS_ASSUME_NONNULL_END
