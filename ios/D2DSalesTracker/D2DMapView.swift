import Foundation
import MapKit

protocol D2DMapViewDelegate: AnyObject {
  func mapView(_ mapView: D2DMapView, didTapKnock knock: KnockAnnotation)
  func mapView(_ mapView: D2DMapView, didTapAt coordinate: CLLocationCoordinate2D)
  func mapView(_ mapView: D2DMapView, regionDidChange animated: Bool)
}

class D2DMapView: MKMapView {
  weak var d2dDelegate: D2DMapViewDelegate?
  
  override init(frame: CGRect) {
    super.init(frame: frame)
    setupMap()
  }
  
  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setupMap()
  }
  
  private func setupMap() {
    delegate = self
    
    // Add tap gesture for map taps
    let tapGesture = UITapGestureRecognizer(target: self, action: #selector(handleMapTap(_:)))
    tapGesture.delegate = self
    addGestureRecognizer(tapGesture)
    
    // Configure map appearance
    mapType = .standard
    isRotateEnabled = false
    isPitchEnabled = false
    showsCompass = true
    showsScale = true
    showsUserLocation = false
  }
  
  @objc private func handleMapTap(_ gesture: UITapGestureRecognizer) {
    let point = gesture.location(in: self)
    let coordinate = convert(point, toCoordinateFrom: self)
    d2dDelegate?.mapView(self, didTapAt: coordinate)
  }
}

// MARK: - MKMapViewDelegate

extension D2DMapView: MKMapViewDelegate {
  func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
    if annotation is MKUserLocation {
      return nil
    }
    
    if let knock = annotation as? KnockAnnotation {
      let identifier = "KnockAnnotation"
      var annotationView = mapView.dequeueReusableAnnotationView(withIdentifier: identifier) as? MKMarkerAnnotationView
      
      if annotationView == nil {
        annotationView = MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: identifier)
        annotationView?.canShowCallout = true
        annotationView?.animatesWhenAdded = true
      } else {
        annotationView?.annotation = annotation
      }
      
      // Configure marker based on knock outcome
      switch knock.outcome {
      case "sold":
        annotationView?.markerTintColor = .systemGreen
        annotationView?.glyphImage = UIImage(systemName: "checkmark.circle.fill")
      case "not_home":
        annotationView?.markerTintColor = .systemOrange
        annotationView?.glyphImage = UIImage(systemName: "house.slash")
      case "not_interested":
        annotationView?.markerTintColor = .systemRed
        annotationView?.glyphImage = UIImage(systemName: "xmark.circle.fill")
      case "callback":
        annotationView?.markerTintColor = .systemBlue
        annotationView?.glyphImage = UIImage(systemName: "phone.arrow.right")
      default:
        annotationView?.markerTintColor = .systemGray
        annotationView?.glyphImage = UIImage(systemName: "questionmark.circle")
      }
      
      return annotationView
    }
    
    return nil
  }
  
  func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
    if let knock = view.annotation as? KnockAnnotation {
      d2dDelegate?.mapView(self, didTapKnock: knock)
    }
  }
  
  func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
    d2dDelegate?.mapView(self, regionDidChange: animated)
  }
  
  func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
    if let territory = overlay as? TerritoryPolygon {
      let renderer = MKPolygonRenderer(polygon: territory)
      renderer.fillColor = territory.fillColor
      renderer.strokeColor = territory.strokeColor
      renderer.lineWidth = territory.lineWidth
      renderer.alpha = territory.alpha
      return renderer
    }
    
    return MKOverlayRenderer(overlay: overlay)
  }
}

// MARK: - UIGestureRecognizerDelegate

extension D2DMapView: UIGestureRecognizerDelegate {
  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    // Don't interfere with annotation selection
    let location = touch.location(in: self)
    let tappedView = self.hitTest(location, with: nil)
    return !(tappedView is MKAnnotationView)
  }
}

// MARK: - KnockAnnotation

class KnockAnnotation: NSObject, MKAnnotation {
  let id: String
  let coordinate: CLLocationCoordinate2D
  let title: String?
  let subtitle: String?
  let outcome: String
  let address: String?
  let notes: String?
  let timestamp: String
  
  init?(from dict: [String: Any]) {
    guard let id = dict["id"] as? String,
          let latitude = dict["latitude"] as? Double,
          let longitude = dict["longitude"] as? Double,
          let outcome = dict["outcome"] as? String,
          let timestamp = dict["timestamp"] as? String else {
      return nil
    }
    
    self.id = id
    self.coordinate = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    self.outcome = outcome
    self.timestamp = timestamp
    self.address = dict["address"] as? String
    self.notes = dict["notes"] as? String
    
    // Set title and subtitle for callout
    self.title = address ?? "Knock"
    self.subtitle = outcome.replacingOccurrences(of: "_", with: " ").capitalized
    
    super.init()
  }
  
  func toDictionary() -> [String: Any] {
    var dict: [String: Any] = [
      "id": id,
      "latitude": coordinate.latitude,
      "longitude": coordinate.longitude,
      "outcome": outcome,
      "timestamp": timestamp
    ]
    
    if let address = address { dict["address"] = address }
    if let notes = notes { dict["notes"] = notes }
    
    return dict
  }
}

// MARK: - TerritoryPolygon

class TerritoryPolygon: MKPolygon {
  var id: String = ""
  var name: String = ""
  var fillColor: UIColor = UIColor.systemBlue.withAlphaComponent(0.2)
  var strokeColor: UIColor = UIColor.systemBlue
  var highlightColor: UIColor = UIColor.systemYellow.withAlphaComponent(0.4)
  var lineWidth: CGFloat = 2.0
  var alpha: CGFloat = 1.0
  var isHighlighted: Bool = false
  
  convenience init?(from dict: [String: Any]) {
    guard let id = dict["id"] as? String,
          let coordinates = dict["coordinates"] as? [[String: Any]] else {
      return nil
    }
    
    let points = coordinates.compactMap { coord -> CLLocationCoordinate2D? in
      guard let lat = coord["latitude"] as? Double,
            let lon = coord["longitude"] as? Double else {
        return nil
      }
      return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
    
    guard !points.isEmpty else { return nil }
    
    self.init(coordinates: points, count: points.count)
    self.id = id
    self.name = dict["name"] as? String ?? ""
    
    // Parse colors if provided
    if let fillColorHex = dict["fillColor"] as? String {
      self.fillColor = UIColor(hex: fillColorHex) ?? self.fillColor
    }
    if let strokeColorHex = dict["strokeColor"] as? String {
      self.strokeColor = UIColor(hex: strokeColorHex) ?? self.strokeColor
    }
  }
}

// MARK: - UIColor Extension

extension UIColor {
  convenience init?(hex: String) {
    let r, g, b, a: CGFloat
    
    var hexColor = hex.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    
    if hexColor.hasPrefix("#") {
      hexColor.remove(at: hexColor.startIndex)
    }
    
    guard hexColor.count == 6 || hexColor.count == 8 else { return nil }
    
    var hexNumber: UInt64 = 0
    guard Scanner(string: hexColor).scanHexInt64(&hexNumber) else { return nil }
    
    if hexColor.count == 6 {
      r = CGFloat((hexNumber & 0xFF0000) >> 16) / 255
      g = CGFloat((hexNumber & 0x00FF00) >> 8) / 255
      b = CGFloat(hexNumber & 0x0000FF) / 255
      a = 1.0
    } else {
      r = CGFloat((hexNumber & 0xFF000000) >> 24) / 255
      g = CGFloat((hexNumber & 0x00FF0000) >> 16) / 255
      b = CGFloat((hexNumber & 0x0000FF00) >> 8) / 255
      a = CGFloat(hexNumber & 0x000000FF) / 255
    }
    
    self.init(red: r, green: g, blue: b, alpha: a)
  }
}