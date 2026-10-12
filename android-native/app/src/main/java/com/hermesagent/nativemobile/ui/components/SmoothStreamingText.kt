package com.hermesagent.nativemobile.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.hermesagent.nativemobile.ui.theme.HermesBorder
import com.hermesagent.nativemobile.ui.theme.HermesPanel
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
            delay(8)
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

    Box(
        modifier = modifier
            .fillMaxWidth(0.92f)
            .shadow(2.dp, RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomEnd = 18.dp, bottomStart = 4.dp), ambientColor = Color(0x06000000), spotColor = Color(0x06000000))
            .clip(RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomEnd = 18.dp, bottomStart = 4.dp))
            .background(HermesPanel)
            .border(1.dp, HermesBorder, RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomEnd = 18.dp, bottomStart = 4.dp))
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        MarkdownContent(content = visibleText)
    }
}
