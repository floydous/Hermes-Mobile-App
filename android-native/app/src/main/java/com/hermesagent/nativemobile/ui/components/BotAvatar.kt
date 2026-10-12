package com.hermesagent.nativemobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.hermesagent.nativemobile.data.model.LiveProfile
import com.hermesagent.nativemobile.ui.theme.AccentAmber
import com.hermesagent.nativemobile.ui.theme.AccentGreen
import com.hermesagent.nativemobile.ui.theme.AccentRed
import com.hermesagent.nativemobile.ui.theme.HermesBg
import com.hermesagent.nativemobile.ui.theme.HermesBorder
import com.hermesagent.nativemobile.ui.theme.White
import kotlin.math.absoluteValue

val AvatarSeedGradients = listOf(
    listOf(Color(0xFF8B5CF6), Color(0xFF6D28D9)), // Violet
    listOf(Color(0xFF3B82F6), Color(0xFF1D4ED8)), // Blue
    listOf(Color(0xFF10B981), Color(0xFF047857)), // Emerald
    listOf(Color(0xFFF59E0B), Color(0xFFB45309)), // Amber
    listOf(Color(0xFFEC4899), Color(0xFFBE185D)), // Pink
    listOf(Color(0xFF06B6D4), Color(0xFF0E7490)), // Cyan
    listOf(Color(0xFF6366F1), Color(0xFF4338CA)), // Indigo
    listOf(Color(0xFFF97316), Color(0xFFC2410C))  // Orange
)

fun getAvatarGradient(name: String): Brush {
    val hash = name.hashCode().absoluteValue
    val colors = AvatarSeedGradients[hash % AvatarSeedGradients.size]
    return Brush.linearGradient(colors)
}

fun getInitials(name: String): String {
    val parts = name.split(Regex("[-_ ]+")).filter { it.isNotBlank() }
    return when {
        parts.size >= 2 -> "${parts[0].take(1)}${parts[1].take(1)}".uppercase()
        parts.size == 1 -> parts[0].take(2).uppercase()
        else -> "H"
    }
}

@Composable
fun BotAvatar(
    profile: LiveProfile?,
    fallbackName: String,
    size: Dp = 44.dp,
    isWorking: Boolean = false,
    isWaitingInput: Boolean = false,
    modifier: Modifier = Modifier
) {
    val name = profile?.displayName ?: profile?.name ?: fallbackName
    val avatarUrl = profile?.avatar
    val initials = getInitials(name)
    val gradient = getAvatarGradient(name)

    Box(
        modifier = modifier.size(size),
        contentAlignment = Alignment.Center
    ) {
        if (!avatarUrl.isNullOrBlank()) {
            // Render explicit image asset / data URL
            AsyncImage(
                model = avatarUrl,
                contentDescription = name,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxSize()
                    .clip(CircleShape)
                    .border(1.dp, HermesBorder, CircleShape)
            )
        } else {
            // Render deterministic gradient avatar with initials
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .clip(CircleShape)
                    .background(gradient)
                    .border(1.dp, Color(0x20FFFFFF), CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = initials,
                    fontSize = (size.value * 0.38f).sp,
                    fontWeight = FontWeight.Bold,
                    color = White
                )
            }
        }

        // Status Pip
        if (isWorking || isWaitingInput) {
            val pipColor = if (isWaitingInput) AccentRed else AccentAmber
            Box(
                modifier = Modifier
                    .size((size.value * 0.25f).coerceAtLeast(8f).dp)
                    .align(Alignment.BottomEnd)
                    .clip(CircleShape)
                    .background(pipColor)
                    .border(2.dp, HermesBg, CircleShape)
            )
        }
    }
}
