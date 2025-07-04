# Native Module Build Instructions (iOS)

## Prerequisites

1. **Install EAS CLI** (if not already installed):
```bash
npm install -g eas-cli
```

2. **Login to EAS**:
```bash
eas login
```

3. **Configure EAS** (if not already done):
```bash
eas build:configure
```

## Building the iOS Development Client

### Step 1: Enable Native Modules in Config

The native storage module is disabled by default. To test it:

1. Open `src/config/optimization.ts`
2. Set `USE_NATIVE_STORAGE: true`

### Step 2: Build Development Client

```bash
# Build for iOS (physical device)
eas build --profile development --platform ios

# OR build for iOS simulator (faster for testing)
eas build --profile development --platform ios --local
```

### Step 3: Install the Development Build

1. **For physical device**: 
   - Wait for build to complete (~10-20 minutes)
   - Scan the QR code or click the link to install

2. **For simulator**:
   - Download the build artifact
   - Drag the .app file to your iOS simulator

### Step 4: Run the App

1. Start your development server:
```bash
npm start
```

2. Open the development build on your device/simulator
3. It will connect to your local server just like Expo Go

## Testing Native Storage

1. Navigate to Settings → Native Module Testing
2. Run the tests:
   - **Check Native Modules**: Verifies modules are loaded
   - **Test Save & Load**: Tests basic functionality
   - **Compare Performance**: Shows speed improvements
   - **Toggle Kill Switch**: Enable/disable native storage
   - **Emergency Kill Switch**: Disable all native modules

## Expected Performance Improvements

With native storage enabled, you should see:
- Save operations: 10-50x faster (150ms → 3-10ms)
- Load operations: 10-100x faster (500ms → 5-50ms)
- Smooth handling of 10k+ knocks

## Troubleshooting

### Native module not found
- Make sure you're running the development build, not Expo Go
- Check that the Swift files are included in the iOS project
- Rebuild with `eas build --clear-cache`

### Performance not improved
- Verify `USE_NATIVE_STORAGE` is `true`
- Check console logs for "Using NATIVE StorageService"
- Run the performance comparison test

### Kill switch not working
- The kill switch immediately falls back to AsyncStorage
- Check logs for "Native storage disabled by kill switch"
- Emergency kill switch disables ALL native modules

## Next Steps

Once native storage is working:
1. Test with large datasets (1000+ knocks)
2. Verify all 15 knock outcomes work correctly
3. Test cloud sync with native storage
4. Monitor memory usage and battery impact

## Development Workflow

1. JavaScript changes: Hot reload works normally
2. Native module changes: Requires rebuild (~10 min)
3. Most work is JavaScript, so iteration stays fast

Remember: The native module preserves EXACT functionality - only the speed changes!