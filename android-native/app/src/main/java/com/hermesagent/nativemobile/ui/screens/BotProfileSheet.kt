package com.hermesagent.nativemobile.ui.screens

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hermesagent.nativemobile.data.model.LiveProfile
import com.hermesagent.nativemobile.data.repository.HermesRepository
import com.hermesagent.nativemobile.ui.components.BotAvatar
import com.hermesagent.nativemobile.ui.theme.HermesBg
import com.hermesagent.nativemobile.ui.theme.HermesBorder
import com.hermesagent.nativemobile.ui.theme.HermesBorderSubtle
import com.hermesagent.nativemobile.ui.theme.HermesMuted
import com.hermesagent.nativemobile.ui.theme.HermesPanel
import com.hermesagent.nativemobile.ui.theme.HermesSecondary
import com.hermesagent.nativemobile.ui.theme.HermesSurface
import com.hermesagent.nativemobile.ui.theme.HermesText
import com.hermesagent.nativemobile.ui.theme.White
import kotlinx.coroutines.launch

@Composable
fun BotProfileSheet(
    profile: LiveProfile,
    repository: HermesRepository,
    onClose: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var soulText by remember { mutableStateOf(profile.system ?: "") }
    var descriptionText by remember { mutableStateOf(profile.displayName ?: "") }
    var isSavingSoul by remember { mutableStateOf(false) }

    BackHandler {
        onClose()
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(HermesBg)
            .verticalScroll(rememberScrollState())
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            IconButton(onClick = onClose) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = "Close",
                    tint = HermesText
                )
            }
            Text(
                text = "Bot settings",
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
                color = HermesText
            )
            Box(modifier = Modifier.size(48.dp))
        }
        HorizontalDivider(color = HermesBorderSubtle, thickness = 1.dp)

        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Identity Section: Avatar + Name + @handle
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(vertical = 12.dp)
            ) {
                BotAvatar(
                    profile = profile,
                    fallbackName = profile.name,
                    size = 72.dp
                )
                Text(
                    text = profile.displayName ?: profile.name,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    color = HermesText
                )
                Text(
                    text = "@${profile.name}",
                    fontSize = 14.sp,
                    color = HermesMuted
                )
            }

            // SOUL Section (System Instructions)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .shadow(3.dp, RoundedCornerShape(16.dp), ambientColor = Color(0x06000000), spotColor = Color(0x06000000))
                    .clip(RoundedCornerShape(16.dp))
                    .background(HermesPanel)
                    .border(1.dp, HermesBorder, RoundedCornerShape(16.dp))
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Description,
                            contentDescription = "SOUL",
                            tint = HermesSecondary,
                            modifier = Modifier.size(16.dp)
                        )
                        Text(
                            text = "SOUL.md",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = HermesSecondary
                        )
                    }

                    // Save SOUL button
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(9999.dp))
                            .background(HermesText)
                            .clickable(enabled = !isSavingSoul) {
                                scope.launch {
                                    isSavingSoul = true
                                    try {
                                        repository.saveProfileSoul(profile.name, soulText)
                                        Toast.makeText(context, "SOUL saved", Toast.LENGTH_SHORT).show()
                                    } catch (e: Exception) {
                                        Toast.makeText(context, "Failed to save SOUL: ${e.message}", Toast.LENGTH_SHORT).show()
                                    } finally {
                                        isSavingSoul = false
                                    }
                                }
                            }
                            .padding(horizontal = 12.dp, vertical = 6.dp)
                    ) {
                        Text(
                            text = if (isSavingSoul) "Saving…" else "Save",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = White
                        )
                    }
                }

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(140.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(HermesSurface)
                        .border(1.dp, HermesBorder, RoundedCornerShape(12.dp))
                        .padding(12.dp)
                ) {
                    if (soulText.isBlank()) {
                        Text(
                            text = "Define the bot's core prompt, personality, and capabilities…",
                            fontSize = 13.sp,
                            color = HermesMuted
                        )
                    }
                    BasicTextField(
                        value = soulText,
                        onValueChange = { soulText = it },
                        textStyle = TextStyle(
                            fontSize = 13.sp,
                            color = HermesText,
                            lineHeight = 19.sp
                        ),
                        cursorBrush = SolidColor(HermesText),
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }

            // Model Section
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .shadow(3.dp, RoundedCornerShape(16.dp), ambientColor = Color(0x06000000), spotColor = Color(0x06000000))
                    .clip(RoundedCornerShape(16.dp))
                    .background(HermesPanel)
                    .border(1.dp, HermesBorder, RoundedCornerShape(16.dp))
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Memory,
                        contentDescription = "Model",
                        tint = HermesSecondary,
                        modifier = Modifier.size(16.dp)
                    )
                    Text(
                        text = "Active Model",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = HermesSecondary
                    )
                }

                Text(
                    text = profile.model ?: "default (server auto-select)",
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                    color = HermesText
                )
                Text(
                    text = "Provider: ${profile.provider ?: "local"}",
                    fontSize = 12.sp,
                    color = HermesMuted
                )
            }
        }
    }
}
