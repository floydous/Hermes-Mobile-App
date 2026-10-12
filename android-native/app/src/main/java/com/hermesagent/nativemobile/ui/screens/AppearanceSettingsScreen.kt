package com.hermesagent.nativemobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.RotateLeft
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hermesagent.nativemobile.ui.theme.AccentGreen
import com.hermesagent.nativemobile.ui.theme.HermesBorder
import com.hermesagent.nativemobile.ui.theme.HermesBorderSubtle
import com.hermesagent.nativemobile.ui.theme.HermesMuted
import com.hermesagent.nativemobile.ui.theme.HermesPanel
import com.hermesagent.nativemobile.ui.theme.HermesSecondary
import com.hermesagent.nativemobile.ui.theme.HermesSurface
import com.hermesagent.nativemobile.ui.theme.HermesText
import com.hermesagent.nativemobile.ui.theme.White
import com.hermesagent.nativemobile.ui.theme.Black
import kotlin.math.roundToInt

data class ThemeOption(
    val id: String,
    val label: String,
    val description: String,
    val swatchColor: Color
)

val AvailableThemes = listOf(
    ThemeOption("light", "Light", "Clean monochrome & zinc palette", Color(0xFFFFFFFF)),
    ThemeOption("grey", "Grey", "Dark grey neutral palette", Color(0xFF202124)),
    ThemeOption("aurora", "Aurora", "Deep navy with cyan accents", Color(0xFF070D18))
)

@Composable
fun AppearanceSettingsScreen(
    currentTheme: String,
    currentScale: Float,
    onThemeChanged: (String) -> Unit,
    onScaleChanged: (Float) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    var selectedTheme by remember { mutableStateOf(currentTheme) }
    var scaleValue by remember { mutableFloatStateOf(currentScale) }

    val scalePercent = (scaleValue * 100).roundToInt()
    val isDefault = kotlin.math.abs(scaleValue - 1.15f) < 0.02f

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(com.hermesagent.nativemobile.ui.theme.getBackgroundColor(selectedTheme))
            .verticalScroll(rememberScrollState())
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = com.hermesagent.nativemobile.ui.theme.getTextColor(selectedTheme)
                )
            }
            Column {
                Text(
                    text = "Appearance",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = com.hermesagent.nativemobile.ui.theme.getTextColor(selectedTheme)
                )
                Text(
                    text = "Theme & Text Size",
                    fontSize = 12.sp,
                    color = com.hermesagent.nativemobile.ui.theme.getMutedColor(selectedTheme)
                )
            }
        }
        HorizontalDivider(color = HermesBorderSubtle, thickness = 1.dp)

        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            // Section 1: Themes
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "THEME",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = com.hermesagent.nativemobile.ui.theme.getMutedColor(selectedTheme)
                )

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .shadow(2.dp, RoundedCornerShape(16.dp), ambientColor = Color(0x06000000), spotColor = Color(0x06000000))
                        .clip(RoundedCornerShape(16.dp))
                        .background(com.hermesagent.nativemobile.ui.theme.getSurfaceColor(selectedTheme))
                        .border(1.dp, com.hermesagent.nativemobile.ui.theme.getBorderColor(selectedTheme), RoundedCornerShape(16.dp))
                ) {
                    AvailableThemes.forEachIndexed { index, item ->
                        val isSelected = item.id.equals(selectedTheme, ignoreCase = true)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    selectedTheme = item.id
                                    onThemeChanged(item.id)
                                }
                                .padding(horizontal = 16.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(14.dp)
                            ) {
                                // Swatch Box
                                Box(
                                    modifier = Modifier
                                        .size(24.dp)
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(item.swatchColor)
                                        .border(1.dp, Color(0x24000000), RoundedCornerShape(8.dp))
                                )

                                Column {
                                    Text(
                                        text = item.label,
                                        fontSize = 15.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = com.hermesagent.nativemobile.ui.theme.getTextColor(selectedTheme)
                                    )
                                    Text(
                                        text = item.description,
                                        fontSize = 12.sp,
                                        color = com.hermesagent.nativemobile.ui.theme.getMutedColor(selectedTheme)
                                    )
                                }
                            }

                            if (isSelected) {
                                Icon(
                                    imageVector = Icons.Default.Check,
                                    contentDescription = "Selected",
                                    tint = com.hermesagent.nativemobile.ui.theme.getTextColor(selectedTheme),
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }

                        if (index < AvailableThemes.size - 1) {
                            HorizontalDivider(color = HermesBorderSubtle, thickness = 1.dp)
                        }
                    }
                }
            }

            // Section 2: Text & Display Size
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "TEXT & DISPLAY SIZE",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = com.hermesagent.nativemobile.ui.theme.getMutedColor(selectedTheme)
                    )

                    Text(
                        text = "$scalePercent%${if (isDefault) " · Default" else ""}",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = com.hermesagent.nativemobile.ui.theme.getMutedColor(selectedTheme)
                    )
                }

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .shadow(2.dp, RoundedCornerShape(16.dp), ambientColor = Color(0x06000000), spotColor = Color(0x06000000))
                        .clip(RoundedCornerShape(16.dp))
                        .background(com.hermesagent.nativemobile.ui.theme.getSurfaceColor(selectedTheme))
                        .border(1.dp, com.hermesagent.nativemobile.ui.theme.getBorderColor(selectedTheme), RoundedCornerShape(16.dp))
                        .padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    // Slider
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(text = "A", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = com.hermesagent.nativemobile.ui.theme.getMutedColor(selectedTheme))

                        Slider(
                            value = scaleValue,
                            onValueChange = {
                                scaleValue = it
                                onScaleChanged(it)
                            },
                            valueRange = 0.85f..1.25f,
                            steps = 7,
                            modifier = Modifier.weight(1f),
                            colors = SliderDefaults.colors(
                                thumbColor = com.hermesagent.nativemobile.ui.theme.getTextColor(selectedTheme),
                                activeTrackColor = com.hermesagent.nativemobile.ui.theme.getTextColor(selectedTheme),
                                inactiveTrackColor = com.hermesagent.nativemobile.ui.theme.getBorderColor(selectedTheme)
                            )
                        )

                        Text(text = "A", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = com.hermesagent.nativemobile.ui.theme.getTextColor(selectedTheme))
                    }

                    // Presets
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        listOf(
                            "Compact" to 0.85f,
                            "Normal" to 1.0f,
                            "Default" to 1.15f,
                            "X-Large" to 1.25f
                        ).forEach { (label, presetVal) ->
                            val isActive = kotlin.math.abs(scaleValue - presetVal) < 0.02f
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (isActive) com.hermesagent.nativemobile.ui.theme.getTextColor(selectedTheme) else HermesSurface)
                                    .clickable {
                                        scaleValue = presetVal
                                        onScaleChanged(presetVal)
                                    }
                                    .padding(vertical = 8.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = label,
                                    fontSize = 11.sp,
                                    fontWeight = if (isActive) FontWeight.SemiBold else FontWeight.Medium,
                                    color = if (isActive) (if (selectedTheme == "light") White else Black) else com.hermesagent.nativemobile.ui.theme.getTextColor(selectedTheme)
                                )
                            }
                        }
                    }

                    // Live Preview Card
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(HermesSurface)
                            .border(1.dp, HermesBorder, RoundedCornerShape(12.dp))
                            .padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(
                            text = "LIVE PREVIEW",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            color = com.hermesagent.nativemobile.ui.theme.getMutedColor(selectedTheme)
                        )
                        Text(
                            text = "Hermes Agent",
                            fontSize = (13f * scaleValue).sp,
                            fontWeight = FontWeight.SemiBold,
                            color = com.hermesagent.nativemobile.ui.theme.getTextColor(selectedTheme)
                        )
                        Text(
                            text = "Text and interface elements scale smoothly across chats, tabs, and tasks.",
                            fontSize = (12f * scaleValue).sp,
                            color = com.hermesagent.nativemobile.ui.theme.getMutedColor(selectedTheme),
                            lineHeight = (18f * scaleValue).sp
                        )
                    }
                }
            }
        }
    }
}
