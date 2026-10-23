package org.example.mobilebench.islandhost.ui

import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.navigation.NavHostController
import org.example.mobilebench.islandhost.AppStore
import org.example.mobilebench.islandhost.island.IslandHub
import org.example.mobilebench.islandhost.island.IslandKind

/**
 * An island destination: the host draws the normative chrome (header with back control, status chip row with the
 * checkpoint digest element) and the island runtime renders the content below it, including the screen-root probe.
 */
@Composable
fun IslandScreen(store: AppStore, kind: IslandKind, index: Int, nav: NavHostController) {
    val activity = LocalActivity.current as ComponentActivity
    val route = if (kind == IslandKind.DETAIL) Routes.detail(index) else Routes.INSIGHTS
    ScreenFrame(
        store = store,
        route = route,
        screenTag = if (kind == IslandKind.DETAIL) "mb.screen.detail" else "mb.screen.insights",
        title = if (kind == IslandKind.DETAIL) store.label(index) else "Insights",
        onBack = { nav.popBackStack() },
        nativeProbe = false,
    ) {
        AndroidView(
            factory = { IslandHub.open(activity, kind, index) },
            modifier = Modifier.fillMaxWidth().weight(1f),
            onRelease = { view -> IslandHub.close(view) },
        )
    }
}
