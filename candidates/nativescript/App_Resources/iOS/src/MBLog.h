// Marker mirror into the unified log, where drivers and the runner read the control lines (os_log is a macro and
// cannot be called from JavaScript). Compiled into the app by the NativeScript CLI; exposed through module.modulemap.
#import <Foundation/Foundation.h>

@interface MBLog : NSObject
+ (void)line:(NSString *)line;
/// `ws=<wall µs>;ps=<process start wall µs>` for the `proc.anchor` marker.
+ (NSString *)anchorPayload;
/// `fp=<phys_footprint>;pk=<ledger_phys_footprint_peak>` for the `mem` marker, nil when task_info fails.
+ (nullable NSString *)memPayload;
@end
