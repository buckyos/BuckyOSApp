import Foundation
import WebKit

/// One data store per account and Zone: its own cookies and storage. The activation page gets a new
/// one that nothing is kept of.
@MainActor
enum Profiles {
  private static let doomedKey = "content-profiles-doomed"
  private static var used: [String: WKWebsiteDataStore] = [:]

  private static var doomed: Set<String> {
    get { Set(UserDefaults.standard.stringArray(forKey: doomedKey) ?? []) }
    set { UserDefaults.standard.set(Array(newValue), forKey: doomedKey) }
  }

  /// `zone-` and 32 hexadecimal digits.
  private static func identifier(_ profile: String) -> UUID? {
    let digits = profile.hasPrefix("zone-") ? String(profile.dropFirst(5)) : ""
    guard digits.count == 32 else { return nil }
    var parts: [Substring] = []
    var rest = Substring(digits)
    for length in [8, 4, 4, 4, 12] {
      parts.append(rest.prefix(length))
      rest = rest.dropFirst(length)
    }
    return UUID(uuidString: parts.joined(separator: "-"))
  }

  static func store(_ profile: String) -> WKWebsiteDataStore {
    doomed.remove(profile)
    return open(profile)
  }

  private static func open(_ profile: String) -> WKWebsiteDataStore {
    guard let identifier = identifier(profile) else { return .nonPersistent() }
    if let known = used[profile] { return known }
    let store = WKWebsiteDataStore(forIdentifier: identifier)
    used[profile] = store
    return store
  }

  /// Stores of Zones signed out of: what was in them is gone already, and one that was used in a
  /// run can only be removed before its next use.
  static func cleanUp() {
    let names = doomed
    if names.isEmpty { return }
    WKWebsiteDataStore.fetchAllDataStoreIdentifiers { found in
      for name in names {
        guard let identifier = identifier(name), found.contains(identifier) else {
          doomed.remove(name)
          continue
        }
        if used[name] != nil { continue }
        WKWebsiteDataStore.remove(forIdentifier: identifier) { error in
          if let error {
            warn("a data store could not be removed: \(error)")
          } else {
            MainActor.assumeIsolated { _ = doomed.remove(name) }
          }
        }
      }
    }
  }

  // ---- cookies ----

  private static func matches(_ cookie: HTTPCookie, _ url: URL) -> Bool {
    guard let host = url.host?.lowercased() else { return false }
    let domain = cookie.domain.lowercased()
    let here = domain.hasPrefix(".") ? (host == domain.dropFirst() || host.hasSuffix(domain)) : host == domain
    let path = url.path.isEmpty ? "/" : url.path
    let below = cookie.path == "/" || path == cookie.path || path.hasPrefix(cookie.path.hasSuffix("/") ? cookie.path : cookie.path + "/")
    let fresh = cookie.expiresDate.map { $0 > Date() } ?? true
    return here && below && fresh && (!cookie.isSecure || url.scheme == "https")
  }

  /// The way a request to the address would carry them.
  static func cookies(_ profile: String, _ url: URL, done: @escaping (String) -> Void) {
    store(profile).httpCookieStore.getAllCookies { cookies in
      done(cookies.filter { matches($0, url) }.map { "\($0.name)=\($0.value)" }.joined(separator: "; "))
    }
  }

  /// `headers` are `Set-Cookie` texts.
  static func setCookies(_ profile: String, _ url: URL, _ headers: [String], done: @escaping () -> Void) {
    let target = store(profile).httpCookieStore
    let group = DispatchGroup()
    for header in headers {
      for cookie in HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: url) {
        group.enter()
        target.setCookie(cookie) { group.leave() }
      }
    }
    group.notify(queue: .main, execute: done)
  }

  /// Signs a Zone out: everything its pages stored goes.
  static func clear(_ profile: String, done: @escaping () -> Void) {
    guard identifier(profile) != nil else {
      done()
      return
    }
    // From here on it counts only when it is used again.
    doomed.insert(profile)
    nonisolated(unsafe) let done = done
    open(profile).removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) { done() }
  }
}
