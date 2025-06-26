// Service to handle real-time map updates
import { WebView } from 'react-native-webview';
import { Knock } from '../types';

class MapUpdateService {
  private static webViewRef: WebView | null = null;

  // Set the WebView reference from RealMapScreenOptimized
  static setWebViewRef(ref: WebView | null) {
    this.webViewRef = ref;
    console.log('MapUpdateService: WebView ref set', !!ref);
  }

  // Send a single knock update to the map
  static updateSingleKnock(knock: Knock) {
    if (!this.webViewRef) {
      console.log('MapUpdateService: No WebView ref available, skipping single update');
      return false;
    }

    try {
      console.log('MapUpdateService: Sending single knock update', {
        id: knock.id,
        outcome: knock.outcome,
        address: knock.address
      });

      this.webViewRef.postMessage(JSON.stringify({
        type: 'updateSingleKnock',
        knock: knock
      }));

      return true;
    } catch (error) {
      console.error('MapUpdateService: Error sending update', error);
      return false;
    }
  }

  // Check if the service is ready
  static isReady(): boolean {
    return !!this.webViewRef;
  }

  // Clear the reference (for cleanup)
  static clear() {
    this.webViewRef = null;
  }
}

export default MapUpdateService;