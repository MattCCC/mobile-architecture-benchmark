#import "MBLog.h"
#import <os/log.h>

@implementation MBLog
+ (void)line:(NSString *)line {
    os_log(OS_LOG_DEFAULT, "%{public}s", line.UTF8String);
}
@end
