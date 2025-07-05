#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(D2DNativeMap, RCTEventEmitter)

// Map lifecycle methods
RCT_EXTERN_METHOD(createMap:(nonnull NSNumber *)viewTag
                  config:(NSDictionary *)config
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(destroyMap:(nonnull NSNumber *)viewTag)

// Knock management
RCT_EXTERN_METHOD(addKnocks:(nonnull NSNumber *)viewTag
                  knocks:(NSArray *)knocks)

RCT_EXTERN_METHOD(removeKnock:(nonnull NSNumber *)viewTag
                  knockId:(NSString *)knockId)

RCT_EXTERN_METHOD(updateKnock:(nonnull NSNumber *)viewTag
                  knock:(NSDictionary *)knock)

// Territory management
RCT_EXTERN_METHOD(setTerritories:(nonnull NSNumber *)viewTag
                  territories:(NSArray *)territories)

RCT_EXTERN_METHOD(highlightTerritory:(nonnull NSNumber *)viewTag
                  territoryId:(NSString *)territoryId
                  highlight:(BOOL)highlight)

// Camera controls
RCT_EXTERN_METHOD(setCamera:(nonnull NSNumber *)viewTag
                  camera:(NSDictionary *)camera
                  animated:(BOOL)animated)

RCT_EXTERN_METHOD(fitToKnocks:(nonnull NSNumber *)viewTag
                  padding:(NSDictionary *)padding
                  animated:(BOOL)animated)

// User location
RCT_EXTERN_METHOD(setShowsUserLocation:(nonnull NSNumber *)viewTag
                  show:(BOOL)show)

RCT_EXTERN_METHOD(setFollowsUserLocation:(nonnull NSNumber *)viewTag
                  follow:(BOOL)follow)

// Utility methods
RCT_EXTERN_METHOD(takeSnapshot:(nonnull NSNumber *)viewTag
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

// Event emitters are handled automatically

@end