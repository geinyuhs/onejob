#!/bin/bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
app_path="${1:-${TMPDIR:-/tmp}/onejob-build/onejob.app}"
node_binary="${ONEJOB_NODE:-$(command -v node)}"
mkdir -p "$app_path/Contents/MacOS" "$app_path/Contents/Resources/widget/focus" "$app_path/Contents/Resources/widget/ui" "$app_path/Contents/Resources/ui/server"
cp -R "$repo_root/widget/focus/ui" "$app_path/Contents/Resources/widget/focus/"
cp "$repo_root/widget/ui/palette.css" "$repo_root/widget/ui/orb-tod.js" "$app_path/Contents/Resources/widget/ui/"
cp -R "$repo_root/ui/server/focus" "$app_path/Contents/Resources/ui/server/"
mkdir -p "$app_path/Contents/Resources/connectors/lib"
cp "$repo_root/connectors/lib/fileWalk.mjs" "$repo_root/connectors/lib/fileText.mjs" "$app_path/Contents/Resources/connectors/lib/"
install -m 755 "$node_binary" "$app_path/Contents/Resources/node"
cp "$repo_root/LICENSE" "$app_path/Contents/Resources/Intaglio-LICENSE"
cat > "$app_path/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Onejob</string>
<key>CFBundleIdentifier</key><string>app.onejob.desktop</string>
<key>CFBundleName</key><string>onejob</string>
<key>CFBundleVersion</key><string>11</string>
<key>CFBundleShortVersionString</key><string>0.5.2</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSServices</key><array><dict><key>NSMenuItem</key><dict><key>default</key><string>New onejob</string></dict><key>NSMessage</key><string>newOnejobService</string><key>NSPortName</key><string>onejob</string></dict></array>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>Speak to onejob when you tap the orb. OpenAI dictation uses a temporary recording that is deleted after capture.</string>
<key>NSSpeechRecognitionUsageDescription</key><string>Turn your speech into text on this Mac so you can review it before sending.</string>
</dict></plist>
PLIST
module_cache="${TMPDIR:-/tmp}/onejob-swift-cache"
mkdir -p "$module_cache"
cat "$repo_root/widget/focus/Policy.swift" "$repo_root/widget/focus/Orbs.swift" "$repo_root/widget/focus/App.swift" > "$module_cache/onejob-main.swift"
swiftc -target "$(uname -m)-apple-macosx14.0" -module-cache-path "$module_cache" "$module_cache/onejob-main.swift" -o "$app_path/Contents/MacOS/Onejob" -framework AppKit -framework WebKit -framework Speech -framework AVFoundation
swiftc -target "$(uname -m)-apple-macosx14.0" -module-cache-path "$module_cache" "$repo_root/widget/focus/Search.swift" -o "$app_path/Contents/Resources/OnejobSearch" -framework NaturalLanguage
swiftc -target "$(uname -m)-apple-macosx14.0" -module-cache-path "$module_cache" "$repo_root/widget/focus/Keychain.swift" -o "$app_path/Contents/Resources/OnejobKeychain" -framework Security
xattr -cr "$app_path"
codesign --force --deep --sign - "$app_path"
printf '%s\n' "$app_path"
