package com.hermesagent.nativemobile.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val HermesLightColorScheme = lightColorScheme(
    primary = HermesText,
    onPrimary = White,
    primaryContainer = HermesSurface,
    onPrimaryContainer = HermesText,
    secondary = HermesSecondary,
    onSecondary = White,
    background = HermesBg,
    onBackground = HermesText,
    surface = HermesPanel,
    onSurface = HermesText,
    surfaceVariant = HermesSurface,
    onSurfaceVariant = HermesMuted,
    outline = HermesBorder,
    outlineVariant = HermesBorderSubtle,
)

@Composable
fun HermesTheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = HermesLightColorScheme,
        content = content
    )
}
