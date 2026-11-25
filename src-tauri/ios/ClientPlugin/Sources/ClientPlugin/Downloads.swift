import UIKit
import WebKit

/// Files a page offers, written to the app's documents, which the Files app shows. They are fetched
/// with the session of the view, and only from its Zone.
@MainActor
final class Downloads: NSObject {
  private final class Running {
    let view: String
    let inZone: (String?) -> Bool
    let part: URL
    var name = ""

    init(view: String, inZone: @escaping (String?) -> Bool) {
      self.view = view
      self.inZone = inZone
      part = FileManager.default.temporaryDirectory.appendingPathComponent("download-\(UUID().uuidString)")
    }
  }

  private var running: [ObjectIdentifier: (WKDownload, Running)] = [:]

  static var folder: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }

  /// A page of the Zone offers files of the Zone and what it made itself; an activation page none.
  func accepts(_ url: URL, of view: ContentView) -> Bool {
    let scheme = url.scheme?.lowercased()
    let accepted = scheme == "https" && view.isInZone(url.host) || view.isOfZone && (scheme == "blob" || scheme == "data")
    if !accepted { warn("not downloaded: \(scheme ?? "")") }
    return accepted
  }

  func start(_ download: WKDownload, of view: ContentView) {
    running[ObjectIdentifier(download)] = (download, Running(view: view.id, inZone: { [weak view] in view?.isInZone($0) ?? false }))
    download.delegate = self
  }

  private func clean(_ name: String) -> String {
    let bad = CharacterSet(charactersIn: "\\/:*?\"<>|").union(.controlCharacters)
    let cleaned = name.components(separatedBy: bad).joined(separator: "_").trimmingCharacters(in: .whitespaces)
    let shown = cleaned.trimmingCharacters(in: CharacterSet(charactersIn: "."))
    return shown.isEmpty ? "download" : String(cleaned.hasPrefix(".") ? "_\(cleaned.dropFirst())" : cleaned).prefix(120).description
  }

  /// Where a file of that name goes: one that is there already stays.
  private func place(_ name: String) -> URL {
    let stem = (name as NSString).deletingPathExtension
    let type = (name as NSString).pathExtension
    var place = Self.folder.appendingPathComponent(name)
    var number = 1
    while FileManager.default.fileExists(atPath: place.path) {
      place = Self.folder.appendingPathComponent(type.isEmpty ? "\(stem) (\(number))" : "\(stem) (\(number)).\(type)")
      number += 1
    }
    return place
  }

  private func end(_ download: WKDownload, _ error: Error?) {
    guard let (_, file) = running.removeValue(forKey: ObjectIdentifier(download)) else { return }
    var event: [String: Any] = ["view": file.view, "name": file.name]
    do {
      if let error { throw error }
      let place = place(file.name)
      try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
      try FileManager.default.moveItem(at: file.part, to: place)
      event["name"] = place.lastPathComponent
      event["path"] = place.path
      event["success"] = true
    } catch {
      warn("a download failed: \(error)")
      try? FileManager.default.removeItem(at: file.part)
      event["success"] = false
    }
    Native.event("download", event)
  }

  /// Hands a downloaded file to the system's share sheet; nothing else can be shared.
  static func share(_ path: String, on presenter: UIViewController) {
    let file = URL(fileURLWithPath: path).standardizedFileURL
    let folder = folder.standardizedFileURL.path
    guard file.path.hasPrefix(folder + "/"), FileManager.default.fileExists(atPath: file.path) else { return }
    let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
    sheet.popoverPresentationController?.sourceView = presenter.view
    presenter.present(sheet, animated: true)
  }
}

extension Downloads: WKDownloadDelegate {
  func download(
    _ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
    completionHandler: @escaping (URL?) -> Void
  ) {
    guard let (_, file) = running[ObjectIdentifier(download)] else {
      completionHandler(nil)
      return
    }
    if let status = (response as? HTTPURLResponse)?.statusCode, !(200...299).contains(status) {
      file.name = clean(suggestedFilename)
      completionHandler(nil)
      end(download, URLError(.badServerResponse))
      return
    }
    file.name = clean(suggestedFilename)
    completionHandler(file.part)
  }

  func download(
    _ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void
  ) {
    let inZone = running[ObjectIdentifier(download)].map { $0.1.inZone(request.url?.host) } ?? false
    decisionHandler(inZone && request.url?.scheme == "https" ? .allow : .cancel)
  }

  func downloadDidFinish(_ download: WKDownload) {
    end(download, nil)
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    end(download, error)
  }
}
