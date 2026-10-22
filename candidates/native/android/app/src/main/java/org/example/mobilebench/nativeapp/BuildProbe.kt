package org.example.mobilebench.nativeapp

/**
 * Incremental-build probe (design §10.6 F2): the harness changes this constant, rebuilds and restores it.
 * Shown in the Detail footer so it cannot be removed as dead code.
 */
object BuildProbe {
    const val VALUE = "probe-0"
}
