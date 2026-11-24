import Foundation
import XCTest
@testable import JKPerformance

/// The F19 contract fixtures (docs/api/wp6-ai-voice.md): every state decodes,
/// the bubble is chosen by kind, the copy matches the per-state table, and a
/// client view never carries analysis.
final class VoiceDecodingTests: XCTestCase {
    private func message(_ name: String) throws -> Message {
        try Fixture.decode(Message.self, "voice/\(name).json")
    }

    func testEveryMessageFixtureDecodesAsAVoiceNote() throws {
        let names = try Fixture.all("voice").filter {
            !$0.hasSuffix("consent.json") && !$0.hasSuffix("me-features.json") && !$0.hasSuffix("-since.json")
        }
        XCTAssertGreaterThanOrEqual(names.count, 11)
        for path in names {
            let m = try Fixture.decode(Message.self, path)
            XCTAssertTrue(m.isVoice, path)
            XCTAssertNil(m.mediaId, "\(path): voice notes carry no top-level mediaId")
            XCTAssertNil(m.mediaUrl, path)
            XCTAssertEqual(m.mediaKind, "audio", path)
            XCTAssertNotNil(m.voice, path)
            XCTAssertNotNil(m.updatedAt, path)
        }
    }

    func testPending() throws {
        let v = try XCTUnwrap(message("voice-pending").voice)
        XCTAssertEqual(v.status, .pending)
        XCTAssertEqual(v.durationSec, 42)
        XCTAssertNil(v.transcript)
        XCTAssertTrue(v.playable)
        XCTAssertEqual(VoiceCopy.state(v, forClient: true), "Transcribing…")
    }

    func testDoneClientViewHasNoAnalysis() throws {
        let m = try message("voice-done-client-view")
        let v = try XCTUnwrap(m.voice)
        XCTAssertEqual(v.status, .done)
        XCTAssertEqual(v.mediaId, "md_Vt3kq0Lw8sYb")
        XCTAssertEqual(v.url, "/api/media/md_Vt3kq0Lw8sYb")
        XCTAssertEqual(v.provider, "openrouter")
        XCTAssertNotNil(v.transcript)
        XCTAssertFalse(v.hasAnalysis)
        XCTAssertEqual(VoiceCopy.state(v, forClient: true), "Automatic transcript, may contain mistakes")
        // The raw JSON a client gets has none of the analysis keys.
        let json = try XCTUnwrap(String(data: Fixture.data("voice/voice-done-client-view.json"), encoding: .utf8))
        for key in ["summary", "mood", "sentiment", "topics", "actions", "flags"] {
            XCTAssertFalse(json.contains("\"\(key)\""), key)
        }
    }

    func testDoneCoachViewCarriesAnalysis() throws {
        let v = try XCTUnwrap(message("voice-done-coach-view").voice)
        XCTAssertTrue(v.hasAnalysis)
        XCTAssertEqual(v.mood, "steady")
        XCTAssertEqual(v.sentiment, -0.2)
        XCTAssertEqual(v.topics ?? [], ["knee", "running", "lunges"])
        XCTAssertEqual(v.actions?.count, 2)
        XCTAssertEqual(v.actions?.first?.owner, "coach")
        let flag = try XCTUnwrap(v.flags?.first)
        XCTAssertEqual(flag.kind, "pain")
        XCTAssertEqual(flag.label, "Pain")
        XCTAssertTrue(flag.isUrgent)
        XCTAssertEqual(flag.severity, "medium")
        XCTAssertEqual(VoiceCopy.mood(v.mood), "Steady")
    }

    func testStubAndCoachCaption() throws {
        let stub = try XCTUnwrap(message("voice-done-stub").voice)
        XCTAssertEqual(VoiceCopy.state(stub, forClient: false), "Sample transcript (AI is off)")
        let coach = try message("voice-from-coach-caption")
        XCTAssertEqual(coach.fromRole, "coach")
        XCTAssertEqual(coach.text, "Plan for this week")
        XCTAssertEqual(coach.voice?.durationSec, 27)
    }

    func testFailedOffAndDeletedCopy() throws {
        let failed = try XCTUnwrap(message("voice-failed").voice)
        XCTAssertEqual(VoiceCopy.state(failed, forClient: true), "Couldn't transcribe this one")
        let aiOff = try XCTUnwrap(message("voice-off-aiOff").voice)
        XCTAssertEqual(aiOff.reason, "aiOff")
        XCTAssertEqual(VoiceCopy.state(aiOff, forClient: true), "Transcripts are off")
        let quota = try XCTUnwrap(message("voice-off-quota").voice)
        XCTAssertEqual(VoiceCopy.state(quota, forClient: false), "Transcript not available today")
        let consent = try XCTUnwrap(message("voice-off-noConsent").voice)
        XCTAssertEqual(VoiceCopy.state(consent, forClient: false), "Not transcribed")
        XCTAssertEqual(VoiceCopy.state(consent, forClient: true), "You chose no transcription")
        XCTAssertTrue(VoiceCopy.offersConsentChange(consent, forClient: true))
        XCTAssertFalse(VoiceCopy.offersConsentChange(consent, forClient: false))
        let deleted = try message("voice-deleted")
        let v = try XCTUnwrap(deleted.voice)
        XCTAssertEqual(v.status, .deleted)
        XCTAssertNil(v.mediaId)
        XCTAssertNil(v.url)
        XCTAssertFalse(v.playable, "a deleted note has no player")
        XCTAssertEqual(VoiceCopy.state(v, forClient: true), "Voice note deleted")
        XCTAssertEqual(deleted.text, "Voice note deleted")
    }

    func testUnknownStatusDecodesAsFailed() throws {
        let v = try XCTUnwrap(message("voice-unknown-status").voice)
        XCTAssertEqual(v.status, .failed)
    }

    func testTranscriptRemovedAfterRetention() {
        let v = VoiceInfo(mediaId: "md_1", url: "/api/media/md_1", durationSec: 10, status: .done, transcript: nil)
        XCTAssertEqual(VoiceCopy.state(v, forClient: true), "Transcript removed")
    }

    func testMinimalVoiceBlockDecodes() throws {
        let json = #"{"id":"m1","clientId":"c","fromId":"c","fromRole":"client","text":"Voice note","at":"2026-11-24T08:14:05Z","kind":"voice","voice":{"status":"pending"}}"#
        let m = try JSONCoding.decoder().decode(Message.self, from: Data(json.utf8))
        XCTAssertEqual(m.voice?.status, .pending)
        XCTAssertNil(m.voice?.durationSec)
        XCTAssertNil(m.updatedAt)
    }

    func testOldMessagesStillDecode() throws {
        let json = #"{"id":"m1","clientId":"c","fromId":"c","fromRole":"client","text":"Hi","at":"2026-11-24T08:14:05.120Z"}"#
        let m = try JSONCoding.decoder().decode(Message.self, from: Data(json.utf8))
        XCTAssertFalse(m.isVoice)
        XCTAssertNil(m.voice)
    }

    func testMessagesSince() throws {
        let page = try Fixture.decode(MessagesResponse.self, "voice/voice-messages-since.json")
        XCTAssertTrue(page.messages.isEmpty)
        XCTAssertEqual(page.updated?.count, 1)
        XCTAssertEqual(page.cursor, "2026-11-24T08:14:31.004Z")
        XCTAssertEqual(page.updated?.first?.voice?.status, .done)
    }

    func testTimelineSince() throws {
        let page = try Fixture.decode(TimelineResponse.self, "voice/voice-timeline-since.json")
        XCTAssertNotNil(page.cursor)
        let item = try XCTUnwrap(page.updated?.first)
        XCTAssertEqual(item.kind, "message")
        XCTAssertEqual(item.message?.voice?.status, .done)
        XCTAssertFalse(item.message?.voice?.hasAnalysis ?? true)
    }

    func testMeFeaturesAndConsent() throws {
        struct Wrapper: Decodable { let features: Features }
        let f = try Fixture.decode(Wrapper.self, "voice/voice-me-features.json").features
        XCTAssertEqual(f.voiceNotes, true)
        XCTAssertEqual(f.voiceMaxSec, 300)
        XCTAssertEqual(f.voiceTranscription, "ask")
        let gate = Gate(features: f)
        XCTAssertTrue(gate.voiceNotes)
        XCTAssertEqual(gate.voiceMaxSec, 300)
        XCTAssertFalse(Gate(features: nil).voiceNotes, "an older server shows no mic")
        let consent = try Fixture.decode(VoiceConsent.self, "voice/voice-consent.json")
        XCTAssertEqual(consent.voice, "on")
    }

    func testConsentCopyNamesTheProviderWhenKnown() {
        XCTAssertEqual(VoiceCopy.consent(provider: nil),
                       "Voice notes are transcribed and summarised for JK by an AI service (OpenRouter). The summary is seen only by JK.")
        XCTAssertTrue(VoiceCopy.consent(provider: "Google").contains("(OpenRouter, using Google)"))
    }

    func testPreviewAndClock() {
        XCTAssertEqual(VoiceCopy.preview(seconds: 42), "Voice note · 0:42")
        XCTAssertEqual(VoiceCopy.clock(75), "1:15")
        XCTAssertEqual(VoiceCopy.clock(300), "5:00")
    }

    func testSendErrors() {
        XCTAssertEqual(VoiceCopy.sendError(status: 403, message: "not_enabled"), "Voice notes are off")
        XCTAssertEqual(VoiceCopy.sendError(status: 413, message: "Voice notes are limited to 10 MB"), "Voice notes are limited to 10 MB")
    }
}

/// The refresh rule: merge `updated` by id; poll every 10 s for two minutes while a note is pending.
final class VoiceRefreshTests: XCTestCase {
    struct Row: Identifiable, Equatable { let id: String; var v: Int }

    func testMergeReplacesByIdAndAppendsNew() {
        let merged = VoiceRefresh.merge([Row(id: "a", v: 1), Row(id: "b", v: 1)], updated: [Row(id: "b", v: 2), Row(id: "c", v: 1)])
        XCTAssertEqual(merged, [Row(id: "a", v: 1), Row(id: "b", v: 2), Row(id: "c", v: 1)])
        XCTAssertEqual(VoiceRefresh.merge([Row(id: "a", v: 1)], updated: []), [Row(id: "a", v: 1)])
    }

    func testIntervals() {
        let now = Date()
        XCTAssertEqual(VoiceRefresh.interval(anyPending: false, pendingSince: nil, now: now), 15)
        XCTAssertEqual(VoiceRefresh.interval(anyPending: true, pendingSince: now.addingTimeInterval(-30), now: now), 10)
        XCTAssertEqual(VoiceRefresh.interval(anyPending: true, pendingSince: now.addingTimeInterval(-121), now: now), 15,
                       "after two minutes the fast poll stops")
    }
}
