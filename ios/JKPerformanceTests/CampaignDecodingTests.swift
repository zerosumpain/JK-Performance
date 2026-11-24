import Foundation
import XCTest
@testable import JKPerformance

/// The F13/F14 client fixtures (docs/api/wp4-campaigns.md, captured from the demo world).
final class CampaignDecodingTests: XCTestCase {
    func testMineWithAnActiveEnrolment() throws {
        let mine = try Fixture.decode(CampaignsMine.self, "campaigns/mine-sam.json")
        XCTAssertTrue(mine.invitations.isEmpty)
        XCTAssertEqual(mine.enrolments.count, 2)
        let active = try XCTUnwrap(mine.current.first)
        XCTAssertEqual(active.campaign.name, "12-Week Marathon Build")
        XCTAssertEqual(CampaignText.dayOf(active.day, active.lengthDays), "Day 24 of 84")
        XCTAssertEqual(active.rank.map(CampaignText.rank), "3rd of 4")
        XCTAssertEqual(active.today?.first?.done, true)
        XCTAssertEqual(active.next?.count, 3)
        XCTAssertEqual(active.next?.first?.guideRef?.id, "gb_sqo4QjMQj8va")
        XCTAssertNil(active.today?.first?.guideRef)
        XCTAssertEqual(mine.finished.map(\.campaign.name), ["Ski-fit 6 weeks"])
        XCTAssertTrue(active.planUrl?.hasPrefix("https://") ?? false)
    }

    func testInvitation() throws {
        let mine = try Fixture.decode(CampaignsMine.self, "campaigns/mine-alex-invitation.json")
        let inv = try XCTUnwrap(mine.invitations.first)
        XCTAssertEqual(inv.id, "ce_UW50WTRP2zHu")
        XCTAssertEqual(inv.feePence, 4900)
        XCTAssertEqual(inv.dueFeePence, 4900)
        XCTAssertEqual(inv.kit?.required.count, 3)
        XCTAssertEqual(inv.kit?.optionalPence, 5300)
        XCTAssertEqual(inv.expectedSpendPence, 15300)
        XCTAssertEqual(inv.placesLeft, 2)
        XCTAssertEqual(inv.respondBy, "2026-12-06")
        XCTAssertEqual(inv.campaign.startMode, "fixed")
        XCTAssertFalse(inv.isWaitlisted)
    }

    func testDetail() throws {
        let d = try Fixture.decode(EnrolmentDetail.self, "campaigns/mine-detail.json")
        XCTAssertEqual(d.enrolment.status, "active")
        XCTAssertNil(d.enrolment.invitation)
        XCTAssertEqual(d.phases.count, 4)
        XCTAssertEqual(d.phases.first?.guide?.title, "Your first week")
        XCTAssertEqual(d.activities.count, 64)
        XCTAssertTrue(d.activities.contains { $0.kind == "purchase" && ($0.spendPence ?? 0) > 0 })
        let shoes = try XCTUnwrap(d.kit.first)
        XCTAssertEqual(shoes.bought, true)
        XCTAssertEqual(shoes.spentPence, 12999)
        XCTAssertNotNil(shoes.httpsURL)
        XCTAssertNil(d.kit.first { $0.url == nil }?.httpsURL)
    }

    func testOpenInvitationDetailShape() throws {
        let json = #"""
        {"enrolment":{"id":"ce_1","status":"invited","invitation":{"enrolmentId":"ce_1","campaign":{"id":"cg_1","name":"January Reset"},"feePence":0}},
         "campaign":{"id":"cg_1","name":"January Reset"},"phases":[],"activities":[],"kit":[]}
        """#
        let d = try JSONCoding.decoder().decode(EnrolmentDetail.self, from: Data(json.utf8))
        XCTAssertEqual(d.enrolment.invitation?.campaign.name, "January Reset")
        XCTAssertEqual(d.enrolment.invitation?.dueFeePence, 0)
    }

    func testGuide() throws {
        let g = try Fixture.decode(CoachGuideResponse.self, "campaigns/guide-client.json").guide
        XCTAssertEqual(g.title, "Your first week")
        XCTAssertEqual(g.readMinutes, 1)
        XCTAssertEqual(g.blocks.map(\.t), ["h", "p", "list", "callout", "divider", "p"])
        XCTAssertEqual(g.blocks[2].style, "check")
        XCTAssertEqual(g.blocks[3].tone, "tip")
    }

    func testInlineGuideBlocksAndUnknownTypes() throws {
        let json = #"{"blocks":[{"t":"p","text":"Hi"},{"t":"marquee","text":"no"},{"t":"link","url":"http://x.test","label":"Plain"},{"t":"link","url":"https://shop.test/list","label":"Shop"}]}"#
        let guide = try JSONCoding.decoder().decode(ActivityGuide.self, from: Data(json.utf8))
        let blocks = try XCTUnwrap(guide.blocks)
        XCTAssertEqual(blocks.filter { GuideBlock.known.contains($0.t) }.count, 3)
        XCTAssertNil(blocks[2].httpsURL, "only https links open")
        XCTAssertEqual(blocks[3].httpsURL?.host, "shop.test")
        XCTAssertFalse(guide.isEmpty)
    }

    func testMoneyEntry() {
        XCTAssertEqual(CampaignText.pence(fromPounds: "12"), 1200)
        XCTAssertEqual(CampaignText.pence(fromPounds: "£129.99"), 12999)
        XCTAssertEqual(CampaignText.pence(fromPounds: " 1,250.5 "), 125050)
        XCTAssertNil(CampaignText.pence(fromPounds: "lots"))
        XCTAssertNil(CampaignText.pence(fromPounds: "-3"))
        XCTAssertNil(CampaignText.pence(fromPounds: ""))
    }

    func testOrdinals() {
        XCTAssertEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(CampaignText.ordinal),
                       ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "103rd"])
    }
}

/// Guide text is tokenised for two markers and never treated as HTML.
final class InlineMarkupTests: XCTestCase {
    typealias Run = InlineMarkup.Run

    func testBoldAndItalic() {
        XCTAssertEqual(InlineMarkup.runs("Eat **30–60 g** of carbs"),
                       [Run(text: "Eat "), Run(text: "30–60 g", bold: true), Run(text: " of carbs")])
        XCTAssertEqual(InlineMarkup.runs("_partly done_ counts"),
                       [Run(text: "partly done", italic: true), Run(text: " counts")])
    }

    func testUnderscoresInsideWordsStayText() {
        XCTAssertEqual(InlineMarkup.runs("snake_case_name and 5_000"), [Run(text: "snake_case_name and 5_000")])
    }

    func testUnclosedMarkersStayText() {
        XCTAssertEqual(InlineMarkup.plain("2 ** 3 and _open"), "2 ** 3 and _open")
    }

    func testHTMLStaysText() {
        let html = "<script>alert(1)</script> <b>bold</b>"
        XCTAssertEqual(InlineMarkup.plain(html), html)
    }
}

/// Only https links are tappable; plan links on our host open natively.
final class LinkTests: XCTestCase {
    func testFindsHttpsLinksOnly() {
        let text = "Today's plan: https://jk.strangeramblings.com/plan/ce_1.2.abc. Or http://evil.test and javascript:alert(1)"
        let links = LinkScan.links(in: text)
        XCTAssertEqual(links.map(\.url.absoluteString), ["https://jk.strangeramblings.com/plan/ce_1.2.abc"])
        XCTAssertEqual(String(text[links[0].range]), "https://jk.strangeramblings.com/plan/ce_1.2.abc")
    }

    func testTwoLinksAndParentheses() {
        let links = LinkScan.links(in: "(https://a.test/x) then https://b.test")
        XCTAssertEqual(links.map { $0.url.host ?? "" }, ["a.test", "b.test"])
    }

    func testPlanLinks() throws {
        let host = "jk.strangeramblings.com"
        let plan = try XCTUnwrap(URL(string: "https://jk.strangeramblings.com/plan/ce_hOdT6amCqpnF.1799370767.ImL8Fy7DFvSHm2hX1SzHKdAlzuIm1BO_TxuM-HQMEDU"))
        XCTAssertEqual(PlanLink.parse(plan, host: host), .enrolment("ce_hOdT6amCqpnF"))
        let guide = try XCTUnwrap(URL(string: "https://jk.strangeramblings.com/plan/u_1~gb_9.1799370767.sig/guide/gb_9"))
        XCTAssertEqual(PlanLink.parse(guide, host: host), .guide("gb_9"))
        let foreign = try XCTUnwrap(URL(string: "https://elsewhere.test/plan/ce_1.2.3"))
        XCTAssertNil(PlanLink.parse(foreign, host: host))
        let other = try XCTUnwrap(URL(string: "https://jk.strangeramblings.com/privacy"))
        XCTAssertNil(PlanLink.parse(other, host: host))
        let media = try XCTUnwrap(URL(string: "https://jk.strangeramblings.com/plan/ce_1.2.3/media/md_1"))
        XCTAssertNil(PlanLink.parse(media, host: host))
    }
}
