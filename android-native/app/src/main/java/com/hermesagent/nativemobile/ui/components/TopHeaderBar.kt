package com.hermesagent.nativemobile.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.hermesagent.nativemobile.ui.theme.AccentAmber
import com.hermesagent.nativemobile.ui.theme.AccentGreen
import com.hermesagent.nativemobile.ui.theme.AccentRed
import com.hermesagent.nativemobile.ui.theme.HermesBg
import com.hermesagent.nativemobile.ui.theme.HermesBorder
import com.hermesagent.nativemobile.ui.theme.HermesPanel
import com.hermesagent.nativemobile.ui.theme.HermesSecondary
import com.hermesagent.nativemobile.ui.theme.HermesSurface
import com.hermesagent.nativemobile.ui.theme.HermesText
import com.hermesagent.nativemobile.ui.theme.White

@Composable
fun TopHeaderBar(
    isConnected: Boolean,
    isConnecting: Boolean,
    currentTab: NavigationTab,
    onHostClick: () -> Unit,
    onSearchClick: () -> Unit,
    onSettingsClick: () -> Unit,
    onNewSessionClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val statusColor by animateColorAsState(
        targetValue = when {
            isConnecting -> AccentAmber
            isConnected -> AccentGreen
            else -> AccentRed
        },
        animationSpec = tween(300),
        label = "statusColor"
    )

    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(HermesBg)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Left: Host Node Avatar Button with Status Pip
        Box(
            modifier = Modifier
                .size(36.dp)
                .clickable { onHostClick() },
            contentAlignment = Alignment.Center
        ) {
            // Circular Host Avatar with official Hermes Icon
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .shadow(3.dp, CircleShape)
                    .clip(CircleShape)
                    .background(HermesPanel)
                    .border(1.dp, HermesBorder, CircleShape)
                    .padding(6.dp),
                contentAlignment = Alignment.Center
            ) {
                AsyncImage(
                    model = "file:///android_asset/hermes-agent-icon-transparent.svg",
                    contentDescription = "Hermes Host",
                    modifier = Modifier.size(22.dp)
                )
            }

            // Live Status Pip (Bottom Right)
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .align(Alignment.BottomEnd)
                    .clip(CircleShape)
                    .background(statusColor)
                    .border(2.dp, HermesBg, CircleShape)
            )
        }

        // Right: Action Buttons
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Search button
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(Color(0x0A000000))
                    .border(1.dp, Color(0x12000000), CircleShape)
                    .clickable { onSearchClick() },
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Search,
                    contentDescription = "Search",
                    tint = HermesSecondary,
                    modifier = Modifier.size(18.dp)
                )
            }

            // Settings button
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(Color(0x0A000000))
                    .border(1.dp, Color(0x12000000), CircleShape)
                    .clickable { onSettingsClick() },
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Settings,
                    contentDescription = "Settings",
                    tint = HermesSecondary,
                    modifier = Modifier.size(18.dp)
                )
            }

            // Optional: "+ New" button on Sessions tab
            if (currentTab == NavigationTab.SESSIONS) {
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(9999.dp))
                        .background(HermesText)
                        .clickable { onNewSessionClick() }
                        .padding(horizontal = 12.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Add,
                        contentDescription = "New Session",
                        tint = White,
                        modifier = Modifier.size(15.dp)
                    )
                    Text(
                        text = "New",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = White
                    )
                }
            }
        }
    }
}
