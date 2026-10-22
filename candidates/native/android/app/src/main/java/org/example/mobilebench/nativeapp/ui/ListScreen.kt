package org.example.mobilebench.nativeapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import kotlin.math.floor
import org.example.mobilebench.nativeapp.AppStore
import org.example.mobilebench.nativeapp.bench.BenchKit
import org.example.mobilebench.nativeapp.domain.Format

private val OPTION_TAGS = arrayOf("a", "b", "c")

/** List screen (design §8.1, §8.2): header 56, status row 32, summary bar 48, list container of 72 dp rows. */
@Composable
fun ListScreen(store: AppStore, nav: NavHostController) {
    val listState = rememberLazyListState(initialFirstVisibleItemIndex = store.initialAnchor)
    val density = LocalDensity.current.density
    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex }.collect { store.anchor = it }
    }
    LaunchedEffect(listState) {
        var scrolling = false
        snapshotFlow { listState.isScrollInProgress }.collect { inProgress ->
            if (scrolling && !inProgress) BenchKit.mark("scroll.idle")
            scrolling = inProgress
        }
    }
    ScreenFrame(
        store = store,
        route = Routes.LIST,
        screenTag = "mb.screen.list",
        title = "Items",
        onBack = null,
        actions = {
            NavButton("Selection (${store.selectedCount})", "mb.nav.selection") {
                nav.navigateOnce(Routes.SELECTION)
            }
            NavButton("Insights", "mb.nav.insights") {
                if (nav.currentDestination?.route == Routes.LIST) {
                    BenchKit.insightsRequested()
                    nav.navigate(Routes.INSIGHTS)
                }
            }
        },
    ) {
        SummaryBar(store)
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .testTag("mb.list")
                .onSizeChanged { size -> BenchKit.listLayout(floor(size.height / density).toInt()) },
        ) {
            items(count = store.itemCount, key = { it }) { index ->
                ItemRow(store, index) { nav.navigateOnce(Routes.detail(index)) }
            }
        }
    }
}

@Composable
private fun SummaryBar(store: AppStore) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(48.dp)
            .testTag("mb.summary")
            .summaryProbe(store)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BasicText("Selected ${store.selectedCount}", Modifier.testTag("mb.summary.count"), style = Type.body)
        BasicText(" \u00B7 ", style = Type.body)
        BasicText("Total ${Format.value(store.total)}", Modifier.testTag("mb.summary.total"), style = Type.body)
    }
}

@Composable
private fun ItemRow(store: AppStore, index: Int, onOpen: () -> Unit) {
    val row = store.rows[index]
    val selected = row.selected
    val v0 = row.v0
    val v1 = row.v1
    val v2 = row.v2
    SideEffect { store.rowRenders++ }
    Row(
        Modifier
            .fillMaxWidth()
            .height(72.dp)
            .testTag("mb.row.$index")
            .rowProbe(index)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f)) {
            BasicText(
                store.label(index),
                Modifier.testTag("mb.row.$index.label").clickable(onClick = onOpen),
                style = Type.label,
                maxLines = 1,
            )
            BasicText("Group ${store.model.groups[index]}", style = Type.group, maxLines = 1)
        }
        OptionButton(index, 0, v0, selected == 0) { store.toggle(index, 0) }
        OptionButton(index, 1, v1, selected == 1) { store.toggle(index, 1) }
        OptionButton(index, 2, v2, selected == 2) { store.toggle(index, 2) }
    }
}

@Composable
private fun OptionButton(index: Int, option: Int, value: Int, isSelected: Boolean, onToggle: () -> Unit) {
    val text = Format.optionText(option, value)
    Box(
        Modifier
            .testTag("mb.row.$index.opt.${OPTION_TAGS[option]}")
            .defaultMinSize(minWidth = 48.dp, minHeight = 36.dp)
            .background(if (isSelected) Palette.accent else Palette.neutral, RoundedCornerShape(6.dp))
            .selectable(selected = isSelected, role = Role.Button, onClick = onToggle)
            // One accessibility node per button that carries the id, the text `A 12.34` and the selection state
            // (design §8.12); the inner text node is cleared. Compose reports `selected` of non-Tab roles as
            // AccessibilityNodeInfo checked/checkable, not isSelected.
            .clearAndSetSemantics { this.text = AnnotatedString(text) }
            .padding(horizontal = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        BasicText(text, style = if (isSelected) Type.buttonSelected else Type.button, maxLines = 1)
    }
}
