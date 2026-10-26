#import "MBLog.h"
#import <os/log.h>
#import <mach/mach.h>
#import <sys/sysctl.h>
#import <sys/time.h>
#import <unistd.h>

@implementation MBLog
+ (void)line:(NSString *)line {
    os_log(OS_LOG_DEFAULT, "%{public}s", line.UTF8String);
}

+ (NSString *)anchorPayload {
    struct timeval now;
    gettimeofday(&now, NULL);
    long long ws = (long long)now.tv_sec * 1000000LL + now.tv_usec;
    long long ps = -1;
    struct kinfo_proc info;
    size_t size = sizeof(info);
    int mib[4] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()};
    if (sysctl(mib, 4, &info, &size, NULL, 0) == 0) {
        struct timeval st = info.kp_proc.p_un.__p_starttime;
        ps = (long long)st.tv_sec * 1000000LL + st.tv_usec;
    }
    return [NSString stringWithFormat:@"ws=%lld;ps=%lld", ws, ps];
}

+ (NSString *)memPayload {
    task_vm_info_data_t info;
    mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
    if (task_info(mach_task_self(), TASK_VM_INFO, (task_info_t)&info, &count) != KERN_SUCCESS) {
        return nil;
    }
    return [NSString stringWithFormat:@"fp=%llu;pk=%llu", info.phys_footprint, info.ledger_phys_footprint_peak];
}
@end
