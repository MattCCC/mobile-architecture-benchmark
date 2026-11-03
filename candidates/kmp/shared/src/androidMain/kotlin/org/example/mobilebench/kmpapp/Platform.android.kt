package org.example.mobilebench.kmpapp
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
actual fun Modifier.resourceTags(): Modifier = semantics { testTagsAsResourceId = true }
