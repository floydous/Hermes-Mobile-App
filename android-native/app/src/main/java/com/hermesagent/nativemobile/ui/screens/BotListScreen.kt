package com.hermesagent.nativemobile.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hermesagent.nativemobile.data.model.LiveProfile
import com.hermesagent.nativemobile.data.model.LiveSession
import com.hermesagent.nativemobile.data.repository.ActiveTurn
import com.hermesagent.nativemobile.ui.theme.AccentAmber
import com.hermesagent.nativemobile.ui.theme.AccentIndigo
import com.hermesagent.nativemobile.ui.theme.HermesBg
import com.hermesagent.nativemobile.ui.theme.HermesBorder
import com.hermesagent.nativemobile.ui.theme.HermesBorderSubtle
import com.hermesagent.nativemobile.ui.theme.HermesMuted
import com.hermesagent.nativemobile.ui.theme.HermesSurface
import com.hermesagent.nativemobile.ui.theme.HermesText
import com.hermesagent.nativemobile.ui.theme.White

@Composable
fun BotListScreen(
    profiles: List<LiveProfile>,
    activeTurns: Map<String, ActiveTurn>,
    onBotClick: (LiveProfile, LiveSession?) -> Unit,
    modifier: Modifier = Modifier
) {
    if (profiles.isEmpty()) {
        Box(
            modifier = modifier
                .fillMaxSize()
                .background(HermesBg),
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text(
                    text = "No bots found",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = HermesText
                )
                Text(
                    text = "Connect to your Hermes host to load bots",
                    fontSize = 13.sp,
                    color = HermesMuted
                )
            }
        }
    } else {
        LazyColumn(
            modifier = modifier
                .fillMaxSize()
                .background(HermesBg),
            contentPadding = PaddingValues(bottom = 90.dp)
        ) {
            items(profiles, key = { it.name }) { profile ->
                val session = profile.canonicalSession ?: profile.lastSession
                val activeTurn = activeTurns[profile.name]
                val isWorking = activeTurn != null

                BotRow(
                    profile = profile,
                    session = session,
                    isWorking = isWorking,
                    statusText = activeTurn?.statusText ?: "Thinking…",
                    onClick = { onBotClick(profile, session) }
                )
                HorizontalDivider(color = HermesBorderSubtle, thickness = 1.dp)
            }
        }
    }
}

@Composable
fun BotRow(
    profile: LiveProfile,
    session: LiveSession?,
    isWorking: Boolean,
    statusText: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(13.dp)
    ) {
        // Bot Avatar Circle (44dp)
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(HermesSurface)
                .border(1.dp, HermesBorder, CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = (profile.displayName ?: profile.name).take(1).uppercase(),
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                color = HermesText
            )

            // Pulsing live indicator pip if working
            if (isWorking) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .align(Alignment.BottomEnd)
                        .clip(CircleShape)
                        .background(AccentAmber)
                        .border(1.5.dp, HermesBg, CircleShape)
                )
            }
        }

        // Middle Info (Name + Preview)
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(3.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = profile.displayName ?: profile.name,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = HermesText
                )

                // Working phrase badge
                AnimatedVisibility(
                    visible = isWorking,
                    enter = fadeIn(),
                    exit = fadeOut()
                ) {
                    Text(
                        text = statusText,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = AccentIndigo
                    )
                }
            }

            Text(
                text = if (isWorking) "Generating response…" else (session?.preview?.ifBlank { "No messages yet" } ?: "No messages yet"),
                fontSize = 13.sp,
                color = HermesMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}
