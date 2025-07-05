import Foundation
import MapKit
import React

@objc(D2DNativeMap)
class D2DNativeMap: RCTEventEmitter {
  
  private var mapViews: [NSNumber: D2DMapView] = [:]
  private var hasListeners = false
  
  override init() {
    super.init()
  }
  
  // MARK: - RCTEventEmitter
  
  override static func moduleName() -> String! {
    return "D2DNativeMap"
  }
  
  override func supportedEvents() -> [String]! {
    return [
      "onMapReady",
      "onKnockPress",
      "onMapPress",
      "onRegionChange",
      "onRegionChangeComplete",
      "onUserLocationChange",
      "onTerritoryPress"
    ]
  }
  
  override func startObserving() {
    hasListeners = true
  }
  
  override func stopObserving() {
    hasListeners = false
  }
  
  // MARK: - Map Lifecycle
  
  @objc
  func createMap(_ viewTag: NSNumber, config: [String: Any], resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      
      // Find the view
      guard let view = self.bridge.uiManager.view(forReactTag: viewTag) else {
        reject("VIEW_NOT_FOUND", "Could not find view with tag \(viewTag)", nil)
        return
      }
      
      // Create map view
      let mapView = D2DMapView(frame: view.bounds)
      mapView.d2dDelegate = self
      mapView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      
      // Apply initial config
      if let initialRegion = config["initialRegion"] as? [String: Any],
         let region = regionFrom(initialRegion) {
        mapView.setRegion(region, animated: false)
      }
      
      if let showsUserLocation = config["showsUserLocation"] as? Bool {
        mapView.showsUserLocation = showsUserLocation
      }
      
      if let showsCompass = config["showsCompass"] as? Bool {
        mapView.showsCompass = showsCompass
      }
      
      if let showsScale = config["showsScale"] as? Bool {
        mapView.showsScale = showsScale
      }
      
      // Add to view hierarchy
      view.addSubview(mapView)
      self.mapViews[viewTag] = mapView
      
      resolve(nil)
    }
  }
  
  @objc
  func destroyMap(_ viewTag: NSNumber) {
    DispatchQueue.main.async { [weak self] in
      if let mapView = self?.mapViews[viewTag] {
        mapView.removeFromSuperview()
        self?.mapViews.removeValue(forKey: viewTag)
      }
    }
  }
  
  // MARK: - Knock Management
  
  @objc
  func addKnocks(_ viewTag: NSNumber, knocks: [[String: Any]]) {
    DispatchQueue.main.async { [weak self] in
      guard let mapView = self?.mapViews[viewTag] else { return }
      
      for knockData in knocks {
        if let knock = KnockAnnotation(from: knockData) {
          mapView.addAnnotation(knock)
        }
      }
    }
  }
  
  @objc
  func removeKnock(_ viewTag: NSNumber, knockId: String) {
    DispatchQueue.main.async { [weak self] in
      guard let mapView = self?.mapViews[viewTag] else { return }
      
      if let annotation = mapView.annotations.first(where: { ($0 as? KnockAnnotation)?.id == knockId }) {
        mapView.removeAnnotation(annotation)
      }
    }
  }
  
  @objc
  func updateKnock(_ viewTag: NSNumber, knock: [String: Any]) {
    DispatchQueue.main.async { [weak self] in
      guard let mapView = self?.mapViews[viewTag] else { return }
      
      if let knockId = knock["id"] as? String,
         let existingAnnotation = mapView.annotations.first(where: { ($0 as? KnockAnnotation)?.id == knockId }) {
        mapView.removeAnnotation(existingAnnotation)
        
        if let newKnock = KnockAnnotation(from: knock) {
          mapView.addAnnotation(newKnock)
        }
      }
    }
  }
  
  // MARK: - Territory Management
  
  @objc
  func setTerritories(_ viewTag: NSNumber, territories: [[String: Any]]) {
    DispatchQueue.main.async { [weak self] in
      guard let mapView = self?.mapViews[viewTag] else { return }
      
      // Remove existing territories
      mapView.removeOverlays(mapView.overlays.filter { $0 is TerritoryPolygon })
      
      // Add new territories
      for territoryData in territories {
        if let territory = TerritoryPolygon(from: territoryData) {
          mapView.addOverlay(territory)
        }
      }
    }
  }
  
  @objc
  func highlightTerritory(_ viewTag: NSNumber, territoryId: String, highlight: Bool) {
    DispatchQueue.main.async { [weak self] in
      guard let mapView = self?.mapViews[viewTag] else { return }
      
      if let territory = mapView.overlays.first(where: { ($0 as? TerritoryPolygon)?.id == territoryId }) as? TerritoryPolygon {
        territory.isHighlighted = highlight
        if let renderer = mapView.renderer(for: territory) as? MKPolygonRenderer {
          renderer.fillColor = highlight ? territory.highlightColor : territory.fillColor
          renderer.setNeedsDisplay()
        }
      }
    }
  }
  
  // MARK: - Camera Controls
  
  @objc
  func setCamera(_ viewTag: NSNumber, camera: [String: Any], animated: Bool) {
    DispatchQueue.main.async { [weak self] in
      guard let mapView = self?.mapViews[viewTag] else { return }
      
      if let region = self?.regionFrom(camera) {
        mapView.setRegion(region, animated: animated)
      }
    }
  }
  
  @objc
  func fitToKnocks(_ viewTag: NSNumber, padding: [String: Any]?, animated: Bool) {
    DispatchQueue.main.async { [weak self] in
      guard let mapView = self?.mapViews[viewTag] else { return }
      
      let knocks = mapView.annotations.compactMap { $0 as? KnockAnnotation }
      guard !knocks.isEmpty else { return }
      
      var minLat = 90.0
      var maxLat = -90.0
      var minLon = 180.0
      var maxLon = -180.0
      
      for knock in knocks {
        minLat = min(minLat, knock.coordinate.latitude)
        maxLat = max(maxLat, knock.coordinate.latitude)
        minLon = min(minLon, knock.coordinate.longitude)
        maxLon = max(maxLon, knock.coordinate.longitude)
      }
      
      let center = CLLocationCoordinate2D(
        latitude: (minLat + maxLat) / 2,
        longitude: (minLon + maxLon) / 2
      )
      
      let span = MKCoordinateSpan(
        latitudeDelta: (maxLat - minLat) * 1.2,
        longitudeDelta: (maxLon - minLon) * 1.2
      )
      
      let region = MKCoordinateRegion(center: center, span: span)
      mapView.setRegion(region, animated: animated)
    }
  }
  
  // MARK: - User Location
  
  @objc
  func setShowsUserLocation(_ viewTag: NSNumber, show: Bool) {
    DispatchQueue.main.async { [weak self] in
      guard let mapView = self?.mapViews[viewTag] else { return }
      mapView.showsUserLocation = show
    }
  }
  
  @objc
  func setFollowsUserLocation(_ viewTag: NSNumber, follow: Bool) {
    DispatchQueue.main.async { [weak self] in
      guard let mapView = self?.mapViews[viewTag] else { return }
      mapView.userTrackingMode = follow ? .follow : .none
    }
  }
  
  // MARK: - Utilities
  
  @objc
  func takeSnapshot(_ viewTag: NSNumber, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async { [weak self] in
      guard let mapView = self?.mapViews[viewTag] else {
        reject("MAP_NOT_FOUND", "Map view not found", nil)
        return
      }
      
      let options = MKMapSnapshotter.Options()
      options.region = mapView.region
      options.size = mapView.bounds.size
      options.scale = UIScreen.main.scale
      
      let snapshotter = MKMapSnapshotter(options: options)
      snapshotter.start { snapshot, error in
        if let error = error {
          reject("SNAPSHOT_ERROR", error.localizedDescription, error)
          return
        }
        
        guard let snapshot = snapshot else {
          reject("SNAPSHOT_ERROR", "No snapshot generated", nil)
          return
        }
        
        if let data = snapshot.image.pngData() {
          let base64 = data.base64EncodedString()
          resolve(["base64": base64, "width": snapshot.image.size.width, "height": snapshot.image.size.height])
        } else {
          reject("SNAPSHOT_ERROR", "Could not encode image", nil)
        }
      }
    }
  }
  
  // MARK: - Helper Methods
  
  private func regionFrom(_ dict: [String: Any]) -> MKCoordinateRegion? {
    guard let latitude = dict["latitude"] as? Double,
          let longitude = dict["longitude"] as? Double else {
      return nil
    }
    
    let center = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    
    if let latitudeDelta = dict["latitudeDelta"] as? Double,
       let longitudeDelta = dict["longitudeDelta"] as? Double {
      let span = MKCoordinateSpan(latitudeDelta: latitudeDelta, longitudeDelta: longitudeDelta)
      return MKCoordinateRegion(center: center, span: span)
    } else if let zoom = dict["zoom"] as? Double {
      // Convert zoom level to span
      let span = MKCoordinateSpan(latitudeDelta: 0.01 * pow(2, 15 - zoom), longitudeDelta: 0.01 * pow(2, 15 - zoom))
      return MKCoordinateRegion(center: center, span: span)
    }
    
    return nil
  }
  
  @objc
  static override func requiresMainQueueSetup() -> Bool {
    return false
  }
}

// MARK: - D2DMapView Delegate

extension D2DNativeMap: D2DMapViewDelegate {
  func mapView(_ mapView: D2DMapView, didTapKnock knock: KnockAnnotation) {
    guard hasListeners, let viewTag = viewTagFor(mapView) else { return }
    
    sendEvent(withName: "onKnockPress", body: [
      "viewTag": viewTag,
      "knock": knock.toDictionary()
    ])
  }
  
  func mapView(_ mapView: D2DMapView, didTapAt coordinate: CLLocationCoordinate2D) {
    guard hasListeners, let viewTag = viewTagFor(mapView) else { return }
    
    sendEvent(withName: "onMapPress", body: [
      "viewTag": viewTag,
      "coordinate": [
        "latitude": coordinate.latitude,
        "longitude": coordinate.longitude
      ]
    ])
  }
  
  func mapView(_ mapView: D2DMapView, regionDidChange animated: Bool) {
    guard hasListeners, let viewTag = viewTagFor(mapView) else { return }
    
    let region = mapView.region
    sendEvent(withName: "onRegionChangeComplete", body: [
      "viewTag": viewTag,
      "region": [
        "latitude": region.center.latitude,
        "longitude": region.center.longitude,
        "latitudeDelta": region.span.latitudeDelta,
        "longitudeDelta": region.span.longitudeDelta
      ]
    ])
  }
  
  private func viewTagFor(_ mapView: D2DMapView) -> NSNumber? {
    return mapViews.first(where: { $0.value === mapView })?.key
  }
}