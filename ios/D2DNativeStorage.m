#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(D2DNativeStorage, NSObject)

RCT_EXTERN_METHOD(saveKnock:(NSDictionary *)knock
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getKnocks:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getVisibleKnocks:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getRecentKnocks:(NSInteger)limit
                  includeCleared:(BOOL)includeCleared
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getKnocksByDateRange:(NSString *)startDate
                  endDate:(NSString *)endDate
                  includeCleared:(BOOL)includeCleared
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clearKnock:(NSString *)knockId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getClearedKnockIds:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(deleteKnock:(NSString *)knockId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setEnabled:(BOOL)enabled)

RCT_EXTERN_METHOD(isEnabled:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end