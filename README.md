# D2D Sales Tracker

A mobile app for door-to-door sales teams to track knocks, analyze performance, and optimize their sales routes.

## Features

### MVP Features (Implemented)
- **Knock Tracking**: GPS-based location recording with customizable outcomes
- **Real-time Map View**: Visual territory mapping with color-coded pins
- **Analytics Dashboard**: Track KPIs including contact rate, conversion rate, daily/weekly trends
- **Offline Functionality**: Works without internet, syncs when connected
- **Background Location Tracking**: Optional continuous tracking for route optimization

### Outcomes Tracked
- Not Home
- No Soliciting
- Not Interested
- Callback
- Lead
- Sale

## Tech Stack
- **Frontend**: React Native with Expo
- **State Management**: React hooks with AsyncStorage
- **Maps**: React Native Maps (Google Maps)
- **Charts**: React Native Chart Kit
- **Navigation**: React Navigation

## Getting Started

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn
- Expo CLI
- iOS Simulator (Mac) or Android Emulator

### Installation

1. Clone the repository
```bash
git clone https://github.com/SigmaBiz/d2d-sales-tracker.git
cd d2d-sales-tracker
```

2. Install dependencies
```bash
npm install
```

3. Set up environment variables
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your API keys:
# - EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (required for Google Maps)
# - EXPO_PUBLIC_MRMS_PROXY_URL (for hail data)
# - Supabase keys (optional, for cloud sync)
```

4. Start the development server
```bash
npx expo start
```

4. Run on your device
- Press `i` for iOS simulator
- Press `a` for Android emulator
- Scan QR code with Expo Go app on your phone

## Project Structure
```
src/
├── components/     # Reusable UI components
├── navigation/     # Navigation configuration
├── screens/        # Main app screens
├── services/       # Business logic and APIs
├── types/          # TypeScript type definitions
└── utils/          # Helper functions
```

## Key Screens

### Map Screen
- Shows all recorded knocks with color-coded pins
- Real-time location tracking toggle
- Legend for outcome types
- Center on current location

### Knock Screen
- Quick outcome selection
- Automatic address detection
- Optional notes field
- One-tap save functionality

### Stats Screen
- Today's performance metrics
- Contact and conversion rates
- 7-day trend charts
- Outcome distribution pie chart

### Settings Screen
- Configure auto-sync behavior
- Set daily knock goals
- Manage data and privacy
- Toggle features on/off

## Planned Features
- Team management and leaderboards
- Income overlay data for neighborhoods
- Weather and hail tracking integration
- Advanced route optimization
- Export reports
- CRM integration

## Development Notes

### Environment Variables & Security

**Important**: Never commit sensitive API keys to version control!

1. **API Key Security**:
   - Always use environment variables for API keys
   - Add `.env` to `.gitignore` (already configured)
   - Use `.env.example` as a template for team members
   - Restrict API keys in Google Cloud Console:
     - Add application restrictions (bundle ID for mobile apps)
     - Add API restrictions (only enable required APIs)
     - Set up quotas to prevent abuse

2. **Google Maps API Key Setup**:
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create or select a project
   - Enable Maps SDK for iOS and Android
   - Enable Geocoding API (for address lookup)
   - Create an API key and restrict it to your app

### Running in Production Mode
```bash
npx expo build:ios
npx expo build:android
```

### Testing
- Use Expo Go app for quick testing
- Test GPS features on real device
- Ensure offline functionality works

## License
Proprietary - All rights reserved

## Support
For issues or questions, please contact the development team.