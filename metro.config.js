const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add web-specific module resolution
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'react-native-maps') {
    // Return a mock module for web
    return {
      filePath: __dirname + '/src/utils/mapsMock.js',
      type: 'sourceFile',
    };
  }
  
  // Default behavior
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;