package com.jkperformance.app.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Decodes the WP4 client fixtures (docs/api/wp4-campaigns.md, copied into src/test/resources/fixtures/campaigns). */
class CampaignDecodingTest {
    private fun text(name: String): String =
        javaClass.classLoader!!.getResource("fixtures/campaigns/$name.json")!!.readText()

    @Test
    fun activeEnrolmentWithRank() {
        val mine = ApiJson.decodeFromString(MyCampaigns.serializer(), text("mine-sam"))
        assertTrue(mine.invitations.isEmpty())
        val e = mine.enrolments.first { it.status == "active" }
        assertEquals("12-Week Marathon Build", e.campaign!!.name)
        assertEquals("Day 24 of 84", CampaignText.dayOf(e))
        assertEquals("3rd of 4", CampaignText.rank(e.rank!!))
        assertTrue(e.today.isNotEmpty())
        assertTrue(e.today.first().done)
        assertNotNull(e.today.first().doneAt)
        assertEquals(3, e.next.size)
        assertEquals("Fuel the long run", e.next.first { it.guide?.id != null && it.title.startsWith("Long") }.guide!!.title)
        assertTrue(e.planUrl!!.startsWith("https://"))
    }

    @Test
    fun invitationCarriesFeeKitAndPlaces() {
        val mine = ApiJson.decodeFromString(MyCampaigns.serializer(), text("mine-alex-invitation"))
        val i = mine.invitations.single()
        assertEquals(4900, i.feePence)
        assertEquals(4900, i.feeDuePence)
        assertEquals(3, i.kit.required.size)
        assertEquals(15300, i.kit.requiredPence)
        assertEquals(5300, i.kit.optionalPence)
        assertEquals("2 places left", CampaignText.places(i.placesLeft))
        assertEquals("2026-11-01", i.campaign.startsOn)
        assertEquals("12 weeks", CampaignText.length(i.campaign.lengthDays))
        assertFalse(i.waitlisted)
        // A completed enrolment rides along with no next activities and no rank.
        val done = mine.enrolments.single()
        assertEquals("completed", done.status)
        assertNull(done.rank)
        assertTrue(done.next.isEmpty())
    }

    @Test
    fun detailHasPhasesActivitiesAndKit() {
        val d = ApiJson.decodeFromString(CampaignDetail.serializer(), text("mine-detail"))
        assertEquals(4, d.phases.size)
        assertEquals("Your first week", d.phases.first().guide!!.title)
        assertTrue(d.activities.size > 50)
        val shoes = d.kit.first { it.name == "Running shoes" }
        assertTrue(shoes.required)
        assertTrue(shoes.bought)
        assertEquals(12999, shoes.spentPence)
        assertTrue(Links.isSafe(shoes.url))
        assertNull(d.kit.first { it.name == "Running belt" }.spentPence)
        assertEquals("fixed", d.campaign!!.startMode)
    }

    @Test
    fun guideBlocksDecode() {
        val g = ApiJson.decodeFromString(CoachGuideResponse.serializer(), text("guide-client")).guide
        assertEquals("Your first week", g.title)
        assertEquals(listOf("h", "p", "list", "callout", "divider", "p"), g.blocks.map { it.t })
        assertEquals("check", g.blocks[2].style)
        assertEquals(3, g.blocks[2].items!!.size)
        assertEquals("tip", g.blocks[3].tone)
    }

    @Test
    fun unknownBlockTypeStillDecodes() {
        val json = """{"guide":{"id":"gb_1","title":"T","blocks":[{"t":"poll","question":"?"},{"t":"p","text":"ok"}]}}"""
        val g = ApiJson.decodeFromString(CoachGuideResponse.serializer(), json).guide
        assertEquals(listOf("poll", "p"), g.blocks.map { it.t })
    }

    @Test
    fun invitationDetailEnvelope() {
        val json = """{"enrolment":{"id":"ce_1","status":"invited","invitation":{"enrolmentId":"ce_1","campaign":{"id":"cg_1","name":"January Reset"},"feePence":2500,"discountPence":500}},"campaign":{"id":"cg_1","name":"January Reset"}}"""
        val d = ApiJson.decodeFromString(CampaignDetail.serializer(), json)
        assertEquals("invited", d.enrolment.status)
        assertEquals(2000, d.enrolment.invitation!!.feeDuePence)
        assertTrue(d.activities.isEmpty())
    }
}
