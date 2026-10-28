import Foundation

/// Stores notes as a JSON file in Application Support.
///
/// Deliberately a plain file rather than UserDefaults: notes can grow to
/// hundreds of KB, the file can be inspected and backed up by hand, and a
/// corrupt store can be recovered instead of silently resetting.
final class PersistenceManager {

    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    /// ~/Library/Application Support/MDStickyNote
    private let directory: URL
    private var storeURL: URL { directory.appendingPathComponent("notes.json") }
    private var backupDirectory: URL { directory.appendingPathComponent("backups", isDirectory: true) }

    /// How many previous versions to keep. Notes are small; history is cheap.
    private let backupCount = 40

    private let backupStampFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss-SSS"
        formatter.timeZone = .current
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()

    init(directoryName: String = "MDStickyNote") {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        directory = base.appendingPathComponent(directoryName, isDirectory: true)

        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        decoder.dateDecodingStrategy = .iso8601

        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func loadNotes() -> [Note] {
        guard FileManager.default.fileExists(atPath: storeURL.path) else { return [] }
        do {
            let data = try Data(contentsOf: storeURL)
            guard !data.isEmpty else { return [] }
            return try decoder.decode([Note].self, from: data)
        } catch {
            NSLog("[Persistence] load failed: \(error) — quarantining store")
            quarantineCorruptStore()
            return []
        }
    }

    /// Writes atomically so a crash mid-write can never truncate the store.
    ///
    /// The previous contents are rotated into `backups/` first. Note text is
    /// irreplaceable and there is no other copy of it anywhere, so a bad write
    /// -- from this app, another instance of it, or anything else editing the
    /// file -- has to be recoverable.
    func saveNotes(_ notes: [Note]) {
        do {
            let data = try encoder.encode(notes)
            rotateBackup(before: data)
            try data.write(to: storeURL, options: .atomic)
        } catch {
            NSLog("[Persistence] save failed: \(error)")
        }
    }

    /// Keeps the last `backupCount` distinct versions of the store.
    private func rotateBackup(before newData: Data) {
        guard let current = try? Data(contentsOf: storeURL), !current.isEmpty else { return }
        guard current != newData else { return }   // nothing changed, nothing to keep

        try? FileManager.default.createDirectory(at: backupDirectory, withIntermediateDirectories: true)

        let stamp = backupStampFormatter.string(from: Date())
        try? current.write(to: backupDirectory.appendingPathComponent("notes-\(stamp).json"))

        pruneBackups()
    }

    private func pruneBackups() {
        let files = (try? FileManager.default.contentsOfDirectory(
            at: backupDirectory,
            includingPropertiesForKeys: [.contentModificationDateKey]
        )) ?? []

        let sorted = files
            .filter { $0.lastPathComponent.hasPrefix("notes-") }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }

        for stale in sorted.dropFirst(backupCount) {
            try? FileManager.default.removeItem(at: stale)
        }
    }

    /// Most recent backups first.
    func availableBackups() -> [URL] {
        let files = (try? FileManager.default.contentsOfDirectory(at: backupDirectory, includingPropertiesForKeys: nil)) ?? []
        return files
            .filter { $0.lastPathComponent.hasPrefix("notes-") }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
    }

    /// Moves an unreadable store aside so the user can recover it manually
    /// instead of it being overwritten by the next save.
    private func quarantineCorruptStore() {
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let backup = directory.appendingPathComponent("notes.corrupt-\(stamp).json")
        try? FileManager.default.moveItem(at: storeURL, to: backup)
    }
}
