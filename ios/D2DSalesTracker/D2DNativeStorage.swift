import Foundation
import SQLite3
import React

@objc(D2DNativeStorage)
class D2DNativeStorage: NSObject, RCTBridgeModule {
  
  static func moduleName() -> String! {
    return "D2DNativeStorage"
  }
  private var db: OpaquePointer?
  private var enabled: Bool = true
  private let dbPath: String
  
  override init() {
    // Get documents directory
    let documentsPath = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true).first!
    self.dbPath = "\(documentsPath)/d2d_knocks.sqlite"
    
    super.init()
    
    // Initialize database
    self.initializeDatabase()
  }
  
  private func initializeDatabase() {
    // Open database
    if sqlite3_open(dbPath, &db) != SQLITE_OK {
      print("[D2DNativeStorage] Error opening database")
      return
    }
    
    // Create knocks table with EXACT same structure as AsyncStorage
    let createTableSQL = """
      CREATE TABLE IF NOT EXISTS knocks (
        id TEXT PRIMARY KEY,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        address TEXT,
        city TEXT,
        state TEXT,
        outcome TEXT NOT NULL,
        notes TEXT,
        timestamp TEXT NOT NULL,
        cleared INTEGER DEFAULT 0,
        syncStatus TEXT,
        history TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_timestamp ON knocks(timestamp);
      CREATE INDEX IF NOT EXISTS idx_cleared ON knocks(cleared);
      CREATE INDEX IF NOT EXISTS idx_location ON knocks(latitude, longitude);
    """
    
    if sqlite3_exec(db, createTableSQL, nil, nil, nil) != SQLITE_OK {
      print("[D2DNativeStorage] Error creating table")
    } else {
      print("[D2DNativeStorage] Database initialized successfully at \(dbPath)")
    }
  }
  
  // MARK: - React Native Methods
  
  @objc
  func saveKnock(_ knock: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard enabled else {
      reject("DISABLED", "Native storage is disabled", nil)
      return
    }
    
    let insertSQL = """
      INSERT OR REPLACE INTO knocks 
      (id, latitude, longitude, address, city, state, outcome, notes, timestamp, cleared, syncStatus, history)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    
    var statement: OpaquePointer?
    
    if sqlite3_prepare_v2(db, insertSQL, -1, &statement, nil) == SQLITE_OK {
      // Bind parameters - preserving exact data structure
      sqlite3_bind_text(statement, 1, knock["id"] as? String ?? "", -1, nil)
      sqlite3_bind_double(statement, 2, knock["latitude"] as? Double ?? 0)
      sqlite3_bind_double(statement, 3, knock["longitude"] as? Double ?? 0)
      sqlite3_bind_text(statement, 4, knock["address"] as? String ?? "", -1, nil)
      sqlite3_bind_text(statement, 5, knock["city"] as? String ?? "", -1, nil)
      sqlite3_bind_text(statement, 6, knock["state"] as? String ?? "", -1, nil)
      sqlite3_bind_text(statement, 7, knock["outcome"] as? String ?? "", -1, nil)
      sqlite3_bind_text(statement, 8, knock["notes"] as? String ?? "", -1, nil)
      sqlite3_bind_text(statement, 9, knock["timestamp"] as? String ?? "", -1, nil)
      sqlite3_bind_int(statement, 10, knock["cleared"] as? Bool ?? false ? 1 : 0)
      sqlite3_bind_text(statement, 11, knock["syncStatus"] as? String ?? "pending", -1, nil)
      
      // History as JSON string
      if let history = knock["history"] {
        let historyData = try? JSONSerialization.data(withJSONObject: history)
        let historyString = String(data: historyData ?? Data(), encoding: .utf8) ?? "[]"
        sqlite3_bind_text(statement, 12, historyString, -1, nil)
      } else {
        sqlite3_bind_null(statement, 12)
      }
      
      if sqlite3_step(statement) == SQLITE_DONE {
        resolve(nil)
      } else {
        reject("SAVE_ERROR", "Failed to save knock", nil)
      }
    } else {
      reject("PREPARE_ERROR", "Failed to prepare statement", nil)
    }
    
    sqlite3_finalize(statement)
  }
  
  @objc
  func getKnocks(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard enabled else {
      reject("DISABLED", "Native storage is disabled", nil)
      return
    }
    
    let querySQL = "SELECT * FROM knocks ORDER BY timestamp DESC"
    var statement: OpaquePointer?
    var knocks: [[String: Any]] = []
    
    if sqlite3_prepare_v2(db, querySQL, -1, &statement, nil) == SQLITE_OK {
      while sqlite3_step(statement) == SQLITE_ROW {
        let knock = extractKnockFromStatement(statement!)
        knocks.append(knock)
      }
      resolve(knocks)
    } else {
      reject("QUERY_ERROR", "Failed to query knocks", nil)
    }
    
    sqlite3_finalize(statement)
  }
  
  @objc
  func getVisibleKnocks(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard enabled else {
      reject("DISABLED", "Native storage is disabled", nil)
      return
    }
    
    let querySQL = "SELECT * FROM knocks WHERE cleared = 0 ORDER BY timestamp DESC"
    var statement: OpaquePointer?
    var knocks: [[String: Any]] = []
    
    if sqlite3_prepare_v2(db, querySQL, -1, &statement, nil) == SQLITE_OK {
      while sqlite3_step(statement) == SQLITE_ROW {
        let knock = extractKnockFromStatement(statement!)
        knocks.append(knock)
      }
      resolve(knocks)
    } else {
      reject("QUERY_ERROR", "Failed to query visible knocks", nil)
    }
    
    sqlite3_finalize(statement)
  }
  
  @objc
  func getRecentKnocks(_ limit: Int, includeCleared: Bool, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard enabled else {
      reject("DISABLED", "Native storage is disabled", nil)
      return
    }
    
    let querySQL = includeCleared 
      ? "SELECT * FROM knocks ORDER BY timestamp DESC LIMIT ?"
      : "SELECT * FROM knocks WHERE cleared = 0 ORDER BY timestamp DESC LIMIT ?"
    
    var statement: OpaquePointer?
    var knocks: [[String: Any]] = []
    
    if sqlite3_prepare_v2(db, querySQL, -1, &statement, nil) == SQLITE_OK {
      sqlite3_bind_int(statement, 1, Int32(limit))
      
      while sqlite3_step(statement) == SQLITE_ROW {
        let knock = extractKnockFromStatement(statement!)
        knocks.append(knock)
      }
      resolve(knocks)
    } else {
      reject("QUERY_ERROR", "Failed to query recent knocks", nil)
    }
    
    sqlite3_finalize(statement)
  }
  
  @objc
  func clearKnock(_ knockId: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard enabled else {
      reject("DISABLED", "Native storage is disabled", nil)
      return
    }
    
    let updateSQL = "UPDATE knocks SET cleared = 1 WHERE id = ?"
    var statement: OpaquePointer?
    
    if sqlite3_prepare_v2(db, updateSQL, -1, &statement, nil) == SQLITE_OK {
      sqlite3_bind_text(statement, 1, knockId, -1, nil)
      
      if sqlite3_step(statement) == SQLITE_DONE {
        resolve(nil)
      } else {
        reject("UPDATE_ERROR", "Failed to clear knock", nil)
      }
    } else {
      reject("PREPARE_ERROR", "Failed to prepare statement", nil)
    }
    
    sqlite3_finalize(statement)
  }
  
  @objc
  func deleteKnock(_ knockId: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard enabled else {
      reject("DISABLED", "Native storage is disabled", nil)
      return
    }
    
    let deleteSQL = "DELETE FROM knocks WHERE id = ?"
    var statement: OpaquePointer?
    
    if sqlite3_prepare_v2(db, deleteSQL, -1, &statement, nil) == SQLITE_OK {
      sqlite3_bind_text(statement, 1, knockId, -1, nil)
      
      if sqlite3_step(statement) == SQLITE_DONE {
        resolve(nil)
      } else {
        reject("DELETE_ERROR", "Failed to delete knock", nil)
      }
    } else {
      reject("PREPARE_ERROR", "Failed to prepare statement", nil)
    }
    
    sqlite3_finalize(statement)
  }
  
  @objc
  func getKnocksByDateRange(_ startDate: String, endDate: String, includeCleared: Bool, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard enabled else {
      reject("DISABLED", "Native storage is disabled", nil)
      return
    }
    
    let querySQL = includeCleared 
      ? "SELECT * FROM knocks WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC"
      : "SELECT * FROM knocks WHERE timestamp >= ? AND timestamp <= ? AND cleared = 0 ORDER BY timestamp DESC"
    
    var statement: OpaquePointer?
    var knocks: [[String: Any]] = []
    
    if sqlite3_prepare_v2(db, querySQL, -1, &statement, nil) == SQLITE_OK {
      sqlite3_bind_text(statement, 1, startDate, -1, nil)
      sqlite3_bind_text(statement, 2, endDate, -1, nil)
      
      while sqlite3_step(statement) == SQLITE_ROW {
        let knock = extractKnockFromStatement(statement!)
        knocks.append(knock)
      }
      resolve(knocks)
    } else {
      reject("QUERY_ERROR", "Failed to query knocks by date range", nil)
    }
    
    sqlite3_finalize(statement)
  }
  
  @objc
  func getClearedKnockIds(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard enabled else {
      reject("DISABLED", "Native storage is disabled", nil)
      return
    }
    
    let querySQL = "SELECT id FROM knocks WHERE cleared = 1"
    var statement: OpaquePointer?
    var ids: [String] = []
    
    if sqlite3_prepare_v2(db, querySQL, -1, &statement, nil) == SQLITE_OK {
      while sqlite3_step(statement) == SQLITE_ROW {
        if let id = sqlite3_column_text(statement, 0) {
          ids.append(String(cString: id))
        }
      }
      resolve(ids)
    } else {
      reject("QUERY_ERROR", "Failed to query cleared knock ids", nil)
    }
    
    sqlite3_finalize(statement)
  }
  
  // MARK: - Kill Switch Methods
  
  @objc
  func setEnabled(_ enabled: Bool) {
    self.enabled = enabled
    print("[D2DNativeStorage] Native storage \(enabled ? "enabled" : "disabled")")
  }
  
  @objc
  func isEnabled(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    resolve(enabled)
  }
  
  // MARK: - Helper Methods
  
  private func extractKnockFromStatement(_ statement: OpaquePointer) -> [String: Any] {
    var knock: [String: Any] = [:]
    
    // Extract all fields preserving exact structure
    knock["id"] = String(cString: sqlite3_column_text(statement, 0))
    knock["latitude"] = sqlite3_column_double(statement, 1)
    knock["longitude"] = sqlite3_column_double(statement, 2)
    
    if let address = sqlite3_column_text(statement, 3) {
      knock["address"] = String(cString: address)
    }
    if let city = sqlite3_column_text(statement, 4) {
      knock["city"] = String(cString: city)
    }
    if let state = sqlite3_column_text(statement, 5) {
      knock["state"] = String(cString: state)
    }
    
    knock["outcome"] = String(cString: sqlite3_column_text(statement, 6))
    
    if let notes = sqlite3_column_text(statement, 7) {
      knock["notes"] = String(cString: notes)
    }
    
    knock["timestamp"] = String(cString: sqlite3_column_text(statement, 8))
    knock["cleared"] = sqlite3_column_int(statement, 9) == 1
    
    if let syncStatus = sqlite3_column_text(statement, 10) {
      knock["syncStatus"] = String(cString: syncStatus)
    }
    
    // Parse history JSON
    if let historyText = sqlite3_column_text(statement, 11) {
      let historyString = String(cString: historyText)
      if let historyData = historyString.data(using: .utf8),
         let history = try? JSONSerialization.jsonObject(with: historyData) {
        knock["history"] = history
      }
    }
    
    return knock
  }
  
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }
}