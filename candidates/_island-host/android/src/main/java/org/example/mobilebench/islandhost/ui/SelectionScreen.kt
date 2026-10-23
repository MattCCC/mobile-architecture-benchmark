package org.example.mobilebench.islandhost.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import org.example.mobilebench.islandhost.AppStore
import org.example.mobilebench.islandhost.domain.Format

/** Selection screen (design §8.1): selected entries with live values and the live total. */
@Composable
fun SelectionScreen(store: AppStore, nav: NavHostController) {
    ScreenFrame(
        store = store,
        route = Routes.SELECTION,
        screenTag = "mb.screen.selection",
        title = "Selection",
        onBack = { nav.popBackStack() },
    ) {
        Row(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            BasicText("Selected ${store.selectedCount} \u00B7 Total ${Format.value(store.total)}", style = Type.body)
        }
        LazyColumn(Modifier.fillMaxWidth().weight(1f)) {
            items(store.selectedItems, key = { it }) { index -> SelectionEntry(store, index) }
        }
    }
}

@Composable
private fun SelectionEntry(store: AppStore, index: Int) {
    val row = store.rows[index]
    val option = row.selected
    if (option < 0) return
    val value = row.value(option)
    Row(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        BasicText(
            "${store.label(index)} \u00B7 Option ${Format.optionKey(option)} \u2014 ${Format.value(value)}",
            style = Type.body,
            maxLines = 1,
        )
    }
}
