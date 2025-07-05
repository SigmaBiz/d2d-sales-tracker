import Foundation
import React

@objc(D2DNativeModulesPackage)
class D2DNativeModulesPackage: NSObject {
  
  @objc
  static func moduleClasses() -> [AnyClass] {
    return [
      D2DNativeStorage.self,
      D2DNativeMap.self,
      D2DNativeMapViewManager.self
    ]
  }
  
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }
}