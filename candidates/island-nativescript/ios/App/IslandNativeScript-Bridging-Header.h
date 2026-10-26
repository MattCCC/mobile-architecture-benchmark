// Exposes the NativeScript runtime boot (the template's internal/NativeScriptStart) to the Swift island embedding.
// The template's own bridging header skips its imports on iOS (`#ifndef TARGET_OS_WATCH` is always false there).
#import <Foundation/Foundation.h>
#import <NativeScript/NativeScript.h>
#import "NativeScriptStart.h"
