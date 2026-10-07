import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('App icon assets policy', () => {
  it('ensures public and bundled hermes-agent-app-icon match', () => {
    const publicPath = path.resolve(__dirname, '../public/hermes-agent-app-icon.png')
    const assetPath = path.resolve(__dirname, './assets/hermes-agent-app-icon.png')

    expect(fs.existsSync(publicPath)).toBe(true)
    expect(fs.existsSync(assetPath)).toBe(true)

    const publicBuf = fs.readFileSync(publicPath)
    const assetBuf = fs.readFileSync(assetPath)

    expect(publicBuf.length).toBeGreaterThan(1000)
    expect(publicBuf.equals(assetBuf)).toBe(true)
  })

  it('ensures Android mipmap density folders have all launcher icon variants', () => {
    const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']
    const baseRes = path.resolve(__dirname, '../src-tauri/gen/android/app/src/main/res')

    for (const density of densities) {
      const folder = path.join(baseRes, `mipmap-${density}`)
      expect(fs.existsSync(folder)).toBe(true)

      const files = ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png', 'ic_launcher_background.png']
      for (const file of files) {
        const fullPath = path.join(folder, file)
        expect(fs.existsSync(fullPath), `Missing ${fullPath}`).toBe(true)
        expect(fs.statSync(fullPath).size).toBeGreaterThan(0)
      }
    }
  })

  it('ensures adaptive icon XML and manifest refer to valid launcher icons', () => {
    const anydpiXml = path.resolve(__dirname, '../src-tauri/gen/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml')
    const manifestPath = path.resolve(__dirname, '../src-tauri/gen/android/app/src/main/AndroidManifest.xml')

    expect(fs.existsSync(anydpiXml)).toBe(true)
    const xml = fs.readFileSync(anydpiXml, 'utf-8')
    expect(xml).toContain('android:drawable="@mipmap/ic_launcher_foreground"')
    expect(xml).toContain('android:drawable="@mipmap/ic_launcher_background"')

    expect(fs.existsSync(manifestPath)).toBe(true)
    const manifest = fs.readFileSync(manifestPath, 'utf-8')
    expect(manifest).toContain('android:icon="@mipmap/ic_launcher"')
    expect(manifest).toContain('android:roundIcon="@mipmap/ic_launcher_round"')
  })
})
