package org.example.mobilebench.islandhost.ui

import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.navigation.NavHostController
import org.example.mobilebench.islandhost.AppStore
import org.example.mobilebench.islandhost.bench.BenchKit
import org.example.mobilebench.islandhost.island.IslandHub
import org.example.mobilebench.islandhost.island.IslandKind

/** Native navigation/status chrome; the island paints the summary and all List rows. */
@Composable
fun ListScreen(store: AppStore, nav: NavHostController) {
    val activity = LocalActivity.current as ComponentActivity
    ScreenFrame(
        store = store,
        route = Routes.LIST,
        screenTag = "mb.screen.list",
        title = "Items",
        onBack = null,
        nativeProbe = false,
        actions = {
            NavButton("Selection (${store.selectedCount})", "mb.nav.selection") { nav.navigateOnce(Routes.SELECTION) }
            NavButton("Insights", "mb.nav.insights") {
                if (nav.currentDestination?.route == Routes.LIST) {
                    BenchKit.insightsRequested()
                    nav.navigate(Routes.INSIGHTS)
                }
            }
        },
    ) {
        AndroidView(
            factory = { IslandHub.open(activity, IslandKind.LIST, 0) { nav.navigateOnce(Routes.detail(it)) } },
            modifier = Modifier.fillMaxWidth().weight(1f),
            onRelease = { IslandHub.close(it) },
        )
    }
}
