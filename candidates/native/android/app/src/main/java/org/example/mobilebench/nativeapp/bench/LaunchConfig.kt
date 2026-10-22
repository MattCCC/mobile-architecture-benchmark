package org.example.mobilebench.nativeapp.bench

/**
 * Launch configuration (design §6.5, validation rules §5.9). Android passes the keys as Intent string
 * extras (`-e mb.profile small`); only keys starting with `mb.` are considered.
 */
class LaunchConfig(
    val journey: String = "none",
    val profile: String = "representative",
    val server: String? = null,
    val session: String? = null,
    val token: String? = null,
    val dataset: String = "embedded",
    val restore: Boolean = false,
    val remote: String = "embedded",
    val clearModuleCache: Boolean = false,
    val journeyMode: Boolean = false,
    val bridgeBench: String = "0",
    val markerMirror: String = "control",
    val semantics: String = "auto",
    val layoutProbe: Boolean = false,
    /** Known keys with invalid values, or values this candidate does not support. */
    val invalid: List<String> = emptyList(),
    /** Keys starting with `mb.` that are not part of the contract. */
    val unknown: List<String> = emptyList(),
) {
    val isValid: Boolean get() = invalid.isEmpty()

    companion object {
        val PROFILES = setOf("small", "representative", "stress")
        private val JOURNEY = Regex("^[A-Za-z0-9._-]{1,64}$")
        private val SESSION = Regex("^[a-z0-9-]{1,40}$")
        private val TOKEN = Regex("^[0-9a-f]{32}$")
        private val SERVER = Regex("^(ws|http)://([A-Za-z0-9.-]+):([0-9]{4,5})/?$")
        private val LOOPBACK_HOSTS = setOf("localhost", "127.0.0.1", "10.0.2.2")
        private val KNOWN = setOf(
            "mb.journey", "mb.profile", "mb.server", "mb.session", "mb.token", "mb.dataset", "mb.restore",
            "mb.remote", "mb.clearModuleCache", "mb.journeyMode", "mb.bridgeBench", "mb.markerMirror",
            "mb.semantics", "mb.layoutProbe",
        )

        fun parse(raw: Map<String, String?>): LaunchConfig {
            val invalid = mutableListOf<String>()
            val keys = raw.keys.filter { it.startsWith("mb.") }.sorted()
            val unknown = keys.filter { it !in KNOWN }

            fun str(key: String): String? = raw[key]?.trim()

            fun bool(key: String): Boolean = when (str(key)) {
                null -> false
                "0" -> false
                "1" -> true
                else -> {
                    invalid += key
                    false
                }
            }

            fun choice(key: String, default: String, allowed: Set<String>): String {
                val v = str(key) ?: return default
                if (v !in allowed) {
                    invalid += key
                    return default
                }
                return v
            }

            fun pattern(key: String, regex: Regex): String? {
                val v = str(key) ?: return null
                if (!regex.matches(v)) {
                    invalid += key
                    return null
                }
                return v
            }

            val journey = pattern("mb.journey", JOURNEY)
            val profile = choice("mb.profile", "representative", PROFILES)
            val token = pattern("mb.token", TOKEN)
            val server = str("mb.server")?.let { s ->
                val m = SERVER.matchEntire(s)
                val host = m?.groupValues?.get(2)
                val port = m?.groupValues?.get(3)?.toIntOrNull()
                val hostOk = host != null && (host in LOOPBACK_HOSTS || (host.endsWith(".local") && token != null))
                if (port != null && port in 1024..65535 && hostOk) {
                    s
                } else {
                    invalid += "mb.server"
                    null
                }
            }
            val session = pattern("mb.session", SESSION)
            val config = LaunchConfig(
                journey = journey ?: "none",
                profile = profile,
                server = server,
                session = session,
                token = token,
                dataset = choice("mb.dataset", "embedded", setOf("embedded", "network")),
                restore = bool("mb.restore"),
                remote = choice("mb.remote", "embedded", setOf("embedded", "remote")),
                clearModuleCache = bool("mb.clearModuleCache"),
                journeyMode = bool("mb.journeyMode"),
                bridgeBench = choice("mb.bridgeBench", "0", setOf("0", "sync", "async")),
                markerMirror = choice("mb.markerMirror", "control", setOf("control", "all")),
                semantics = choice("mb.semantics", "auto", setOf("auto", "on")),
                layoutProbe = bool("mb.layoutProbe"),
                unknown = unknown,
            )
            // Valid values this candidate cannot honour yet fail loudly instead of measuring something else.
            val unsupported = buildList {
                if (config.server != null) add("mb.server") // WebSocket data source not implemented yet
                if (config.dataset != "embedded") add("mb.dataset")
                if (config.remote != "embedded") add("mb.remote") // no remote mechanism (design §14.7 note 4)
                if (config.bridgeBench != "0") add("mb.bridgeBench") // no bridge (design §14.7 note 6)
            }
            return config.copy(invalid = (invalid + unsupported).distinct())
        }
    }

    fun copy(invalid: List<String>): LaunchConfig = LaunchConfig(
        journey, profile, server, session, token, dataset, restore, remote, clearModuleCache, journeyMode,
        bridgeBench, markerMirror, semantics, layoutProbe, invalid, unknown,
    )
}
