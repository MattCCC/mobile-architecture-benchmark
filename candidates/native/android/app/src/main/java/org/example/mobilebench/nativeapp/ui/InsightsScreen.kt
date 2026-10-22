package org.example.mobilebench.nativeapp.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import org.example.mobilebench.nativeapp.AppStore
import org.example.mobilebench.nativeapp.bench.BenchKit
import org.example.mobilebench.nativeapp.domain.Format

/**
 * Insights (design §8.1, §8.10), embedded only: this candidate has no remote-loading mechanism (§14.7 note 4).
 * The content is computed once when the screen opens; the digest element updates at checkpoints.
 */
@Composable
fun InsightsScreen(store: AppStore, nav: NavHostController) {
    val insights = remember { store.model.insights() }
    DisposableEffect(Unit) {
        store.insightsVisible = true
        onDispose { store.insightsVisible = false }
    }
    ScreenFrame(
        store = store,
        route = Routes.INSIGHTS,
        screenTag = "mb.screen.insights",
        title = "Insights",
        onBack = { nav.popBackStack() },
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .weight(1f)
                .drawWithContent {
                    drawContent()
                    BenchKit.insightsDrawn()
                }
                .padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            BasicText("Top 5 by Option A", style = Type.label)
            Column(Modifier.testTag("mb.insights.top")) {
                insights.topItems.forEachIndexed { k, item ->
                    BasicText(
                        "${store.label(item)} \u00B7 A ${Format.value(insights.topValues[k])}",
                        style = Type.body,
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
            BasicText("Option B distribution", style = Type.label)
            BasicText(insights.buckets.joinToString(", "), Modifier.testTag("mb.insights.buckets"), style = Type.body)
            Spacer(Modifier.height(12.dp))
            BasicText("Source: embedded", Modifier.testTag("mb.insights.source"), style = Type.body)
            BasicText(store.insightsDigestText, Modifier.testTag("mb.insights.digest"), style = Type.tiny)
        }
    }
}
