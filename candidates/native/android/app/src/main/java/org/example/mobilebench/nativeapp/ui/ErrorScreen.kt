package org.example.mobilebench.nativeapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp

/** Fatal app-level error screen (design §8.1). */
@Composable
fun ErrorScreen(code: String) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Palette.background)
            .windowInsetsPadding(WindowInsets.systemBars)
            .semantics { testTagsAsResourceId = true }
            .testTag("mb.screen.error")
            .padding(16.dp),
    ) {
        BasicText("Error: $code", Modifier.testTag("mb.error.code"), style = Type.label)
    }
}
