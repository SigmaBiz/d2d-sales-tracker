import Foundation
import React

@objc(D2DNativeMapViewManager)
class D2DNativeMapViewManager: RCTViewManager {
  
  override func view() -> UIView! {
    return D2DNativeMapContainer()
  }
  
  override static func moduleName() -> String! {
    return "D2DNativeMapView"
  }
  
  @objc
  override static func requiresMainQueueSetup() -> Bool {
    return true
  }
}

class D2DNativeMapContainer: UIView {
  // This container will hold the actual map view
  // The map view will be added by the D2DNativeMap module
  
  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = UIColor.systemBackground
  }
  
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }
}