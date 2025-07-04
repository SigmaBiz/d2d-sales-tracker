# Local Build Instructions for iOS Native Modules

Since there's an SSL certificate issue with CocoaPods CDN, here's how to build locally:

## Option 1: Build with EAS Locally (Recommended)

This builds on your machine instead of EAS servers:

```bash
# Install EAS CLI globally if not installed
npm install -g eas-cli

# Build locally for iOS simulator
eas build --profile development --platform ios --local

# OR build for physical device
eas build --profile development --platform ios --local --ios.simulator false
```

## Option 2: Build with Xcode

1. Open the project in Xcode:
```bash
open ios/D2DSalesTracker.xcworkspace
```

2. In Xcode:
   - Select your device/simulator
   - Add the Swift files to the project:
     - Right-click on D2DSalesTracker folder
     - Add Files to "D2DSalesTracker"
     - Select D2DNativeStorage.swift and D2DNativeStorage.m
     - Make sure "Copy items if needed" is checked
   - Build and run (Cmd+R)

## Option 3: Fix CocoaPods SSL Issue

Try these commands to fix the SSL certificate issue:

```bash
# Update certificates
brew install ca-certificates
brew link --force ca-certificates

# Clear CocoaPods cache
pod cache clean --all

# Remove and reinstall CocoaPods
gem uninstall cocoapods
gem install cocoapods

# Try again
cd ios && pod install
```

## Testing the Native Module

Once built and installed:

1. Start Metro bundler:
```bash
npm start
```

2. Open the app on your device/simulator
3. Navigate to Settings → Native Module Testing
4. Run the tests to verify native storage is working

## Troubleshooting

If the native module isn't found:
- Make sure you're running the dev build, not Expo Go
- Check that USE_NATIVE_STORAGE is set to true in optimization.ts
- Look for console logs about native module availability

The local build option is often faster and avoids network issues!