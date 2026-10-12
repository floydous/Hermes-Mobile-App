package com.hermesagent.nativemobile.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hermesagent.nativemobile.ui.theme.White
import com.hermesagent.nativemobile.ui.theme.Zinc400
import com.hermesagent.nativemobile.ui.theme.Zinc800
import com.hermesagent.nativemobile.ui.theme.Zinc900

enum class NavigationTab(val label: String) {
    BOTS("Bots"),
    SESSIONS("Sessions"),
    TASKS("Tasks")
}

@Composable
fun BottomNavIsland(
    currentTab: NavigationTab,
    onTabSelected: (NavigationTab) -> Unit,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 16.dp),
        contentAlignment = Alignment.Center
    ) {
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(999.dp))
                .background(Zinc900)
                .border(1.dp, Zinc800, RoundedCornerShape(999.dp))
                .padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            NavigationTab.values().forEach { tab ->
                val isSelected = currentTab == tab
                val bgColor by animateColorAsState(
                    targetValue = if (isSelected) Zinc800 else Zinc900,
                    label = "tabBg"
                )
                val textColor by animateColorAsState(
                    targetValue = if (isSelected) White else Zinc400,
                    label = "tabText"
                )

                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(bgColor)
                        .clickable { onTabSelected(tab) }
                        .padding(horizontal = 20.dp, vertical = 8.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = tab.label,
                        fontSize = 13.sp,
                        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium,
                        color = textColor
                    )
                }
            }
        }
    }
}
