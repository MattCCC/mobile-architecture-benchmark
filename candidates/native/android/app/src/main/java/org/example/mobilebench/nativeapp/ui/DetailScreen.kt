package org.example.mobilebench.nativeapp.ui

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import org.example.mobilebench.nativeapp.AppStore
import org.example.mobilebench.nativeapp.BuildProbe
import org.example.mobilebench.nativeapp.bench.BenchKit
import org.example.mobilebench.nativeapp.domain.Format

/** Panel animation (design §8.7): 300 ms, cubic-bezier(0.42, 0, 0.58, 1), translateY +240 dp and opacity. */
private val PanelEasing = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)
private const val PANEL_MS = 300

@Composable
fun DetailScreen(store: AppStore, index: Int, nav: NavHostController) {
    val row = store.rows[index]
    var shown by remember { mutableStateOf(false) }
    var present by remember { mutableStateOf(false) }
    val progress = animateFloatAsState(
        targetValue = if (shown) 1f else 0f,
        animationSpec = tween(durationMillis = PANEL_MS, easing = PanelEasing),
        label = "panel",
        finishedListener = { value ->
            BenchKit.mark("anim.end", if (value >= 1f) "dir=show" else "dir=hide")
            if (value <= 0f) present = false
        },
    )
    ScreenFrame(
        store = store,
        route = Routes.detail(index),
        screenTag = "mb.screen.detail",
        title = store.label(index),
        onBack = { nav.popBackStack() },
    ) {
        Column(Modifier.fillMaxWidth().weight(1f).padding(horizontal = 16.dp, vertical = 8.dp)) {
            BasicText(store.label(index), style = Type.title)
            BasicText("Group ${store.model.groups[index]}", style = Type.group)
            Spacer(Modifier.height(12.dp))
            BasicText(Format.optionText(0, row.v0), Modifier.testTag("mb.detail.values.a"), style = Type.label)
            BasicText(Format.optionText(1, row.v1), Modifier.testTag("mb.detail.values.b"), style = Type.label)
            BasicText(Format.optionText(2, row.v2), Modifier.testTag("mb.detail.values.c"), style = Type.label)
            Spacer(Modifier.height(16.dp))
            BasicText(
                if (shown) "Hide details" else "Show details",
                Modifier
                    .testTag("mb.detail.panel.toggle")
                    .clickable(role = Role.Button) {
                        shown = !shown
                        if (shown) present = true
                        BenchKit.mark("anim.start", if (shown) "dir=show" else "dir=hide")
                    }
                    .padding(vertical = 12.dp),
                style = Type.nav,
            )
            if (present) {
                Column(
                    Modifier
                        .testTag("mb.detail.panel")
                        .fillMaxWidth()
                        .graphicsLayer {
                            val p = progress.value
                            translationY = (1f - p) * 240.dp.toPx()
                            alpha = p
                        }
                        .background(Palette.neutral, RoundedCornerShape(8.dp))
                        .padding(16.dp),
                ) {
                    BasicText("Details of ${store.label(index)}", style = Type.label)
                    BasicText(
                        "Group ${store.model.groups[index]} \u00B7 ${Format.optionText(0, row.v0)} \u00B7 " +
                            "${Format.optionText(1, row.v1)} \u00B7 ${Format.optionText(2, row.v2)}",
                        style = Type.body,
                    )
                }
            }
            Spacer(Modifier.weight(1f))
            BasicText("Build ${BuildProbe.VALUE}", style = Type.tiny)
        }
    }
}
