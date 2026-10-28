import Foundation
import Combine

/// Single source of truth for all notes.
///
/// Every mutation funnels through `update(_:mutate:)`, which is what makes the
/// debounced autosave safe: callers can never write a stale whole-note struct
/// over a newer one, because they only ever mutate the copy the store holds.
final class NoteStore: ObservableObject {

    @Published private(set) var notes: [Note] = []

    private let persistence: PersistenceManager
    private var saveWorkItem: DispatchWorkItem?
    private let saveDelay: TimeInterval = 0.4

    init(persistence: PersistenceManager = PersistenceManager()) {
        self.persistence = persistence
        self.notes = persistence.loadNotes()
    }

    // MARK: - Queries

    func note(_ id: UUID) -> Note? { notes.first { $0.id == id } }

    var isEmpty: Bool { notes.isEmpty }

    // MARK: - Mutation

    @discardableResult
    func addNote(_ note: Note = Note()) -> Note {
        notes.append(note)
        scheduleSave()
        return note
    }

    func deleteNote(_ id: UUID) {
        notes.removeAll { $0.id == id }
        scheduleSave()
    }

    /// Mutates the stored note in place. `touchModified` is false for pure
    /// window bookkeeping (moves, resizes, scroll) so that reordering by
    /// "recently edited" stays meaningful.
    func update(_ id: UUID, touchModified: Bool = false, mutate: (inout Note) -> Void) {
        guard let idx = notes.firstIndex(where: { $0.id == id }) else { return }
        var note = notes[idx]
        mutate(&note)
        if touchModified { note.modifiedAt = Date() }
        guard note != notes[idx] else { return }   // no-op writes must not dirty the store
        notes[idx] = note
        scheduleSave()
    }

    // MARK: - Persistence

    private func scheduleSave() {
        saveWorkItem?.cancel()
        let snapshot = notes
        let work = DispatchWorkItem { [persistence] in persistence.saveNotes(snapshot) }
        saveWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + saveDelay, execute: work)
    }

    /// Flushes any pending save synchronously. Called on quit so the last
    /// keystrokes before Cmd+Q are never lost.
    func flush() {
        saveWorkItem?.cancel()
        saveWorkItem = nil
        persistence.saveNotes(notes)
    }
}
