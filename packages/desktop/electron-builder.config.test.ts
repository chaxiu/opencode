import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"

const legacyDesktopEntry = "resources/linux/opencode-desktop.desktop"

const channels = [
  { channel: "dev", appId: "ai.opencode.desktop.dev" },
  { channel: "beta", appId: "ai.opencode.desktop.beta" },
  { channel: "prod", appId: "ai.opencode.desktop" },
] as const

for (const channel of channels) {
  test(`uses one Linux desktop identity for ${channel.channel}`, async () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = channel.channel

    const module = await import(`./electron-builder.config.ts?channel=${channel.channel}`)
    const config = module.default as Configuration

    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous

    expect(config.appId).toBe(channel.appId)
    expect(config.extraMetadata?.desktopName).toBe(`${channel.appId}.desktop`)
    expect(config.linux?.executableName).toBe(channel.appId)
    expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(channel.appId)
  })
}

test("keeps a hidden prod launcher for old Linux pins", async () => {
  const previous = process.env.OPENCODE_CHANNEL
  process.env.OPENCODE_CHANNEL = "prod"

  const module = await import("./electron-builder.config.ts?compat=prod")
  const config = module.default as Configuration

  if (previous === undefined) delete process.env.OPENCODE_CHANNEL
  else process.env.OPENCODE_CHANNEL = previous

  expect(config.deb?.fpm?.[0]).toEndWith(`${legacyDesktopEntry}=/usr/share/applications/opencode-desktop.desktop`)
  expect(config.rpm?.fpm?.[0]).toEndWith(`${legacyDesktopEntry}=/usr/share/applications/opencode-desktop.desktop`)

  const desktop = await Bun.file(legacyDesktopEntry).text()
  expect(desktop).toContain("Exec=/opt/OpenCode/ai.opencode.desktop %U")
  expect(desktop).toContain("Icon=ai.opencode.desktop")
  expect(desktop).toContain("StartupWMClass=ai.opencode.desktop")
  expect(desktop).toContain("NoDisplay=true")
})

test("allows overriding the appId from the environment", async () => {
  const previousChannel = process.env.OPENCODE_CHANNEL
  const previousAppId = process.env.OPENCODE_DESKTOP_APP_ID
  process.env.OPENCODE_CHANNEL = "prod"
  process.env.OPENCODE_DESKTOP_APP_ID = "com.munk.opencode"

  const module = await import("./electron-builder.config.ts?override=appId")
  const config = module.default as Configuration

  if (previousChannel === undefined) delete process.env.OPENCODE_CHANNEL
  else process.env.OPENCODE_CHANNEL = previousChannel

  if (previousAppId === undefined) delete process.env.OPENCODE_DESKTOP_APP_ID
  else process.env.OPENCODE_DESKTOP_APP_ID = previousAppId

  expect(config.appId).toBe("com.munk.opencode")
  expect(config.extraMetadata?.desktopName).toBe("com.munk.opencode.desktop")
  expect(config.linux?.executableName).toBe("com.munk.opencode")
  expect(config.linux?.desktop?.entry?.StartupWMClass).toBe("com.munk.opencode")
})

test("allows disabling desktop signing and notarization from the environment", async () => {
  const previousSign = process.env.OPENCODE_DESKTOP_SIGN
  const previousNotarize = process.env.OPENCODE_DESKTOP_NOTARIZE
  process.env.OPENCODE_DESKTOP_SIGN = "false"
  process.env.OPENCODE_DESKTOP_NOTARIZE = "false"

  const module = await import("./electron-builder.config.ts?unsigned=desktop")
  const config = module.default as Configuration

  if (previousSign === undefined) delete process.env.OPENCODE_DESKTOP_SIGN
  else process.env.OPENCODE_DESKTOP_SIGN = previousSign

  if (previousNotarize === undefined) delete process.env.OPENCODE_DESKTOP_NOTARIZE
  else process.env.OPENCODE_DESKTOP_NOTARIZE = previousNotarize

  expect(config.mac?.hardenedRuntime).toBe(false)
  expect(config.mac?.notarize).toBe(false)
  expect(config.dmg?.sign).toBe(false)
})
