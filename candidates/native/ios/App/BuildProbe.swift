/// Incremental-build probe (design §10.6 F2): the harness changes this constant, rebuilds and restores it.
/// Shown in the Detail footer so it cannot be removed as dead code.
enum BuildProbe {
    static let value = "probe-0"
}
