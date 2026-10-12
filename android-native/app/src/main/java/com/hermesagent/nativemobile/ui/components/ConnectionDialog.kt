package com.hermesagent.nativemobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.hermesagent.nativemobile.ui.theme.HermesBorder
import com.hermesagent.nativemobile.ui.theme.HermesMuted
import com.hermesagent.nativemobile.ui.theme.HermesPanel
import com.hermesagent.nativemobile.ui.theme.HermesSecondary
import com.hermesagent.nativemobile.ui.theme.HermesSurface
import com.hermesagent.nativemobile.ui.theme.HermesText
import com.hermesagent.nativemobile.ui.theme.White

@Composable
fun ConnectionDialog(
    currentEndpoint: String,
    onDismiss: () -> Unit,
    onSave: (endpoint: String, user: String?, pass: String?) -> Unit
) {
    var endpointText by remember { mutableStateOf(currentEndpoint) }
    var usernameText by remember { mutableStateOf("") }
    var passwordText by remember { mutableStateOf("") }

    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .shadow(16.dp, RoundedCornerShape(24.dp), ambientColor = Color(0x20000000), spotColor = Color(0x20000000))
                .clip(RoundedCornerShape(24.dp))
                .background(HermesPanel)
                .border(1.dp, HermesBorder, RoundedCornerShape(24.dp))
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = "Hermes Host Node",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = HermesText
                )
                Text(
                    text = "Enter your Hermes Gateway IP and Port",
                    fontSize = 13.sp,
                    color = HermesMuted
                )
            }

            // Gateway URL field
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = "GATEWAY URL",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = HermesMuted
                )
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(HermesSurface)
                        .border(1.dp, HermesBorder, RoundedCornerShape(12.dp))
                        .padding(horizontal = 14.dp, vertical = 12.dp)
                ) {
                    BasicTextField(
                        value = endpointText,
                        onValueChange = { endpointText = it },
                        textStyle = TextStyle(
                            fontSize = 14.sp,
                            color = HermesText
                        ),
                        cursorBrush = SolidColor(HermesText),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }

            // Username field (optional)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = "USERNAME (OPTIONAL)",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = HermesMuted
                )
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(HermesSurface)
                        .border(1.dp, HermesBorder, RoundedCornerShape(12.dp))
                        .padding(horizontal = 14.dp, vertical = 12.dp)
                ) {
                    if (usernameText.isEmpty()) {
                        Text(
                            text = "hermes",
                            fontSize = 14.sp,
                            color = HermesMuted
                        )
                    }
                    BasicTextField(
                        value = usernameText,
                        onValueChange = { usernameText = it },
                        textStyle = TextStyle(
                            fontSize = 14.sp,
                            color = HermesText
                        ),
                        cursorBrush = SolidColor(HermesText),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }

            // Password field (optional)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = "PASSWORD (OPTIONAL)",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = HermesMuted
                )
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(HermesSurface)
                        .border(1.dp, HermesBorder, RoundedCornerShape(12.dp))
                        .padding(horizontal = 14.dp, vertical = 12.dp)
                ) {
                    BasicTextField(
                        value = passwordText,
                        onValueChange = { passwordText = it },
                        visualTransformation = PasswordVisualTransformation(),
                        textStyle = TextStyle(
                            fontSize = 14.sp,
                            color = HermesText
                        ),
                        cursorBrush = SolidColor(HermesText),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }

            // Action Buttons
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(12.dp))
                        .background(HermesSurface)
                        .border(1.dp, HermesBorder, RoundedCornerShape(12.dp))
                        .clickable { onDismiss() }
                        .padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "Cancel",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        color = HermesSecondary
                    )
                }

                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(12.dp))
                        .background(HermesText)
                        .clickable {
                            val trimmed = endpointText.trim().trimEnd('/')
                            if (trimmed.isNotBlank()) {
                                onSave(
                                    trimmed,
                                    usernameText.trim().ifBlank { null },
                                    passwordText.ifBlank { null }
                                )
                            }
                        }
                        .padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "Connect",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = White
                    )
                }
            }
        }
    }
}
