import Foundation
import NaturalLanguage

// The standard macOS embedding model runs locally. The launcher additionally
// denies this helper network access. No model download or remote fallback.
struct Item: Decodable { let id: String; let text: String }
struct Search: Decodable { let query: String; let entries: [Item] }
struct Match: Encodable { let id: String; let distance: Double }
struct Reply: Encodable { let available: Bool; let matches: [Match] }
let data = FileHandle.standardInput.readDataToEndOfFile()
do {
    let request = try JSONDecoder().decode(Search.self, from: data)
    var reply = Reply(available: false, matches: [])
    if let model = NLEmbedding.sentenceEmbedding(for: .english) {
        let matches = request.entries.map { item in
            Match(id: item.id, distance: model.distance(between: String(request.query.prefix(2000)), and: String(item.text.prefix(2000)), distanceType: .cosine))
        }.filter { $0.distance.isFinite }.sorted { $0.distance < $1.distance }
        reply = Reply(available: true, matches: Array(matches.prefix(24)))
    }
    FileHandle.standardOutput.write(try JSONEncoder().encode(reply))
} catch let error {
    _ = error
    FileHandle.standardOutput.write(Data("{\"available\":false,\"matches\":[]}".utf8))
}
