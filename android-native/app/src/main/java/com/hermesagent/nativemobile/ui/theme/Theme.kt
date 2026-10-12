package com.hermesagent.nativemobile.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val DarkColorScheme = darkColorScheme(
    primary = White,
    onPrimary = Black,
    primaryContainer = Zinc800,
    onPrimaryContainer = White,
    secondary = Zinc400,
    onSecondary = Black,
    background = Zinc950,
    onBackground = Zinc100,
    surface = Zinc900,
    onSurface = Zinc100,
    surfaceVariant = Zinc850,
    onSurfaceVariant = Zinc400,
    outline = Zinc800,
    outlineVariant = Zinc700,
)

private val LightColorScheme = lightColorScheme(
    primary = Black,
    onPrimary = White,
    primaryContainer = Zinc100,
    onPrimaryContainer = Black,
    secondary = Zinc600,
    onSecondary = White,
    background = White,
    onBackground = Black,
    surface = Zinc50,
    onSurface = Black,
    surfaceVariant = Zinc100,
    onSurfaceVariant = Zinc600,
    outline = Zinc200,
    outlineVariant = Zinc300,
)

@Composable
fun HermesTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    MaterialTheme(
        colorScheme = colorScheme,
        content = content
    )
}
