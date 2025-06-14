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
cd d2d-sales-tracker
```

2. Install dependencies
```bash
npm install
```

3. Start the development server
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