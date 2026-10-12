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
import androidx.compose.foundation.shape.RoundedCornerShape
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
import com.hermesagent.nativemobile.ui.theme.White
import com.hermesagent.nativemobile.ui.theme.Zinc100
import com.hermesagent.nativemobile.ui.theme.Zinc400
import com.hermesagent.nativemobile.ui.theme.Zinc800
import com.hermesagent.nativemobile.ui.theme.Zinc850
import com.hermesagent.nativemobile.ui.theme.Zinc900

@Composable
fun BotListScreen(
    profiles: List<LiveProfile>,
    activeTurns: Map<String, ActiveTurn>,
    onBotClick: (LiveProfile, LiveSession?) -> Unit,
    modifier: Modifier = Modifier
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(profiles, key = { it.name }) { profile ->
            val session = profile.canonicalSession ?: profile.lastSession
            val activeTurn = activeTurns[profile.name]
            val isWorking = activeTurn != null

            BotCardRow(
                profile = profile,
                session = session,
                isWorking = isWorking,
                statusText = activeTurn?.statusText ?: "Working…",
                onClick = { onBotClick(profile, session) }
            )
        }
    }
}

@Composable
fun BotCardRow(
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
            .clip(RoundedCornerShape(16.dp))
            .background(Zinc900)
            .border(1.dp, Zinc850, RoundedCornerShape(16.dp))
            .clickable { onClick() }
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Avatar circle
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(Zinc800),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = (profile.displayName ?: profile.name).take(1).uppercase(),
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
                color = White
            )
        }

        // Details
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = profile.displayName ?: profile.name,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Zinc100
                )

                // Live working indicator
                AnimatedVisibility(
                    visible = isWorking,
                    enter = fadeIn(),
                    exit = fadeOut()
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .clip(CircleShape)
                                .background(AccentAmber)
                        )
                        Text(
                            text = statusText,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                            color = AccentAmber
                        )
                    }
                }
            }

            Text(
                text = if (isWorking) "Generating response…" else (session?.preview ?: "No messages yet"),
                fontSize = 13.sp,
                color = Zinc400,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}
