package com.hermesagent.nativemobile.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.unit.sp
import com.hermesagent.nativemobile.ui.theme.HermesText
import kotlinx.coroutines.delay

@Composable
fun SmoothStreamingText(
    streamingText: String,
    modifier: Modifier = Modifier
) {
    var displayedLength by remember { mutableStateOf(0) }
    val alphaAnim = remember { Animatable(0f) }

    LaunchedEffect(streamingText) {
        val target = streamingText.length
        while (displayedLength < target) {
            displayedLength++
            delay(8) // ~120fps smooth character ticker cadence
        }
    }

    LaunchedEffect(displayedLength) {
        alphaAnim.snapTo(0.4f)
        alphaAnim.animateTo(
            targetValue = 1f,
            animationSpec = tween(durationMillis = 200, easing = FastOutSlowInEasing)
        )
    }

    val visibleText = streamingText.take(displayedLength)

    Box(modifier = modifier.fillMaxWidth()) {
        MarkdownContent(content = visibleText)
    }
}
