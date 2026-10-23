#import <MobileBenchIslandBenchSpec/MobileBenchIslandBenchSpec.h>

NS_ASSUME_NONNULL_BEGIN

/// TurboModule `MobileBenchKit`, island variant: forwards to the island host's marker core (`MBHostBench`).
@interface MBIslandBench : NSObject <NativeMobileBenchKitSpec>
@end

/// The island host's marker API, looked up by name through the Objective-C runtime (class `MBHostBench` of the host
/// app). Without a host (development harness) the class is nil and every call is a no-op returning 0.
@protocol MBHostBenchClass <NSObject>
+ (uint64_t)mark:(NSString *)event payload:(NSString *)payload;
+ (uint64_t)nowNs;
+ (NSInteger)count:(NSString *)event;
+ (void)probeDrawn:(NSString *)kind index:(NSInteger)index token:(NSString *)token;
+ (NSInteger)flush;
+ (NSString *)launchConfigJSON;
+ (NSInteger)fgSeq;
@end

Class<MBHostBenchClass> _Nullable MBIslandHostBench(void);

NS_ASSUME_NONNULL_END
