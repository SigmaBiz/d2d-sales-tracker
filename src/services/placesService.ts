/**
 * Google Places API (New) wrapper for address autocomplete.
 * Session tokens group autocomplete keystrokes + the place-details call into
 * one billed session (generate on first keystroke, discard after selection).
 */
import { GOOGLE_PLACES_API_KEY } from '../config/api.config';

export interface PlacePrediction {
  placeId: string;
  mainText: string;      // "12320 S May Ave"
  secondaryText: string; // "Oklahoma City, OK, USA"
}

const OKC_CENTER = { latitude: 35.4676, longitude: -97.5164 };
const BIAS_RADIUS_METERS = 50000; // bias (not restrict) to the OKC metro

// Google validates iOS-app-restricted keys on REST calls via this header.
// Must match the restriction configured on the key in Google Cloud.
const IOS_BUNDLE_ID = 'com.sigmabiz.d2dsalestracker';

export class PlacesService {
  static hasKey(): boolean {
    return GOOGLE_PLACES_API_KEY.length > 0;
  }

  static newSessionToken(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  static async getPredictions(input: string, sessionToken: string): Promise<PlacePrediction[]> {
    if (!this.hasKey()) throw new Error('Google Places API key not configured');
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Ios-Bundle-Identifier': IOS_BUNDLE_ID,
      },
      body: JSON.stringify({
        input,
        sessionToken,
        includedRegionCodes: ['us'],
        locationBias: { circle: { center: OKC_CENTER, radius: BIAS_RADIUS_METERS } },
      }),
    });
    if (!res.ok) throw new Error(`Places autocomplete HTTP ${res.status}`);
    const data = await res.json();
    return (data.suggestions ?? [])
      .filter((s: any) => s.placePrediction)
      .map((s: any) => ({
        placeId: s.placePrediction.placeId,
        mainText:
          s.placePrediction.structuredFormat?.mainText?.text ??
          s.placePrediction.text?.text ?? '',
        secondaryText: s.placePrediction.structuredFormat?.secondaryText?.text ?? '',
      }));
  }

  static async getPlaceLocation(
    placeId: string,
    sessionToken: string,
  ): Promise<{ address: string; lat: number; lng: number }> {
    if (!this.hasKey()) throw new Error('Google Places API key not configured');
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`,
      {
        headers: {
          'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': 'location,formattedAddress',
          'X-Ios-Bundle-Identifier': IOS_BUNDLE_ID,
        },
      },
    );
    if (!res.ok) throw new Error(`Place details HTTP ${res.status}`);
    const data = await res.json();
    return {
      address: data.formattedAddress ?? '',
      lat: data.location.latitude,
      lng: data.location.longitude,
    };
  }
}
