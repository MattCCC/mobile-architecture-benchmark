package org.example.mobilebench.nativeapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.example.mobilebench.nativeapp.AppStore
import org.example.mobilebench.nativeapp.bench.BenchKit

/** Visual specification (design §8.2): light theme, one accent colour, system default font. */
object Palette {
    val background = Color(0xFFFFFFFF)
    val text = Color(0xFF1A1A1A)
    val secondary = Color(0xFF5F6368)
    val neutral = Color(0xFFE8EAED)
    val accent = Color(0xFF2F6FEB)
    val onAccent = Color(0xFFFFFFFF)
    val faint = Color(0xFFBDBDBD)
}

object Type {
    val title = TextStyle(color = Palette.text, fontSize = 20.sp, fontWeight = FontWeight.Bold)
    val label = TextStyle(color = Palette.text, fontSize = 16.sp)
    val group = TextStyle(color = Palette.secondary, fontSize = 14.sp)
    val body = TextStyle(color = Palette.text, fontSize = 14.sp)
    val button = TextStyle(color = Palette.text, fontSize = 14.sp)
    val buttonSelected = TextStyle(color = Palette.onAccent, fontSize = 14.sp)
    val nav = TextStyle(color = Palette.accent, fontSize = 15.sp, fontWeight = FontWeight.Medium)
    val chip = TextStyle(color = Palette.text, fontSize = 12.sp)
    val tiny = TextStyle(color = Palette.faint, fontSize = 8.sp)
}

/**
 * Screen root with the normative top bands (design §8.2): top system inset, header 56, status chip row 32.
 * The root probe reports draws to BenchKit; reading the token state here forces a redraw on change (§6.2).
 */
@Composable
fun ScreenFrame(
    store: AppStore,
    route: String,
    screenTag: String,
    title: String,
    onBack: (() -> Unit)?,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Palette.background)
            .rootProbe(store, route)
            .windowInsetsPadding(WindowInsets.systemBars)
            .testTag(screenTag),
    ) {
        Row(
            Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                NavButton("Back", "mb.nav.back", onBack)
            } else {
                Spacer(Modifier.width(8.dp))
            }
            BasicText(title, Modifier.weight(1f).padding(horizontal = 8.dp), style = Type.title, maxLines = 1)
            actions()
        }
        StatusRow(store)
        content()
    }
}

@Composable
fun NavButton(text: String, tag: String, onClick: () -> Unit) {
    BasicText(
        text,
        Modifier
            .testTag(tag)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 12.dp),
        style = Type.nav,
        maxLines = 1,
    )
}

/** Status chip row (32): stream status left, the checkpoint digest element right (tiny, low contrast). */
@Composable
fun StatusRow(store: AppStore) {
    Row(
        Modifier.fillMaxWidth().height(32.dp).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        BasicText(
            store.status.word,
            Modifier
                .testTag("mb.stream.status")
                .background(Palette.neutral, RoundedCornerShape(12.dp))
                .padding(horizontal = 10.dp, vertical = 2.dp),
            style = Type.chip,
        )
        BasicText(store.digestText, Modifier.testTag("mb.state.digest"), style = Type.tiny, maxLines = 1)
    }
}

/** Root probe (design §6.2/§6.3): tokens nav:<navSeq>, fg:<fgSeq>, restore:<route>:<anchor>. */
fun Modifier.rootProbe(store: AppStore, route: String): Modifier = drawWithContent {
    drawContent()
    BenchKit.rootDrawn(route, store.topRoute == route, store.navSeq, store.fgSeq)
}

/** Row probe: first draw with token fui0 joins the FUI gate; inert afterwards. */
fun Modifier.rowProbe(index: Int): Modifier = drawWithContent {
    drawContent()
    BenchKit.rowDrawn(index)
}

/** Summary probe: fui0 for the gate, then rev:<selectionRevision> for `resp`. */
fun Modifier.summaryProbe(store: AppStore): Modifier = drawWithContent {
    drawContent()
    BenchKit.summaryDrawn(store.selectionRevision, store.selectedCount)
}
