"""Offline tests for the PATLive intake parser and update planning.

Run: python3 -m unittest discover -s workers/patlive-intake -v   (from repo root)
No network, no credentials.
"""

import pathlib
import unittest

import intake

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "patlive-sample.eml"


def sample_lead():
    return intake.extract_lead(intake.lead_from_eml(FIXTURE))


class ParseTests(unittest.TestCase):
    def test_letter_ref_and_caller(self):
        lead = sample_lead()
        self.assertEqual(lead.letter_ref, "9251")
        self.assertEqual(lead.caller_name, "Wayne Wagner")
        self.assertEqual(lead.callback_phone, "+1 (218) 280-0901")
        self.assertEqual(lead.caller_id, "+12182800901")
        self.assertEqual(lead.message_date, "09/29/2026 12:24:29 PM")
        self.assertEqual(lead.receptionist, "Heidi T.")
        self.assertEqual(lead.patlive_number, "+13854980419")
        self.assertEqual(lead.message_id, "<WSRmEbuQSGaQehRtNIkf4Q@geopod-ismtpd-73>")

    def test_answers(self):
        lead = sample_lead()
        self.assertEqual(lead.answer("size"), "5.1 acres")
        self.assertEqual(lead.answer("road access"), "Yes")
        self.assertEqual(lead.answer("paved or unpaved"), "Unpaved")
        self.assertEqual(lead.answer("electricity"), "No")
        self.assertEqual(lead.answer("free and clear"), "Yes")
        self.assertEqual(lead.answer("how much do you owe"), "")
        self.assertEqual(lead.answer("looking to get"), "$16,000")
        self.assertEqual(lead.answer("ok with you"), "Yes")
        self.assertEqual(lead.answer("comments"), "")
        # header "Caller Name" is not counted as a Q&A answer twice
        self.assertEqual(sum(1 for q, _ in lead.answers if q == "Caller Name"), 1)

    def test_message_url_from_html(self):
        lead = sample_lead()
        self.assertEqual(
            lead.message_url,
            "https://flex.patlive.com/receptionist/message/fb45f114-7851-4f71-a55d-0f0f6b1b4864",
        )
        self.assertEqual(intake.comment_marker(lead), "fb45f114-7851-4f71-a55d-0f0f6b1b4864")

    def test_html_only_fallback(self):
        msg = intake.lead_from_eml(FIXTURE)
        msg.text = ""
        lead = intake.extract_lead(msg)
        self.assertEqual(lead.letter_ref, "9251")
        self.assertEqual(lead.callback_phone, "+1 (218) 280-0901")
        self.assertEqual(lead.answer("looking to get"), "$16,000")
        self.assertEqual(lead.receptionist, "Heidi T.")

    def test_ref_with_noise(self):
        msg = intake.lead_from_eml(FIXTURE)
        msg.text = msg.text.replace("    9251\n", "    # 9251 (on the letter)\n")
        self.assertEqual(intake.extract_lead(msg).letter_ref, "9251")

    def test_missing_ref(self):
        msg = intake.lead_from_eml(FIXTURE)
        msg.text = msg.text.replace("    9251\n", "    \n")
        msg.html_body = ""
        self.assertIsNone(intake.extract_lead(msg).letter_ref)


class CommentTests(unittest.TestCase):
    def test_comment_block(self):
        lead = sample_lead()
        block = intake.build_comment(lead, [{"property_id": "10884"}])
        self.assertIn("[PATLive 09/29/2026 12:24:29 PM]", block)
        self.assertIn("letter ref 9251", block)
        self.assertIn("Callback: +1 (218) 280-0901", block)
        self.assertIn("Road access: Yes (Unpaved)", block)
        self.assertIn("Asking: $16,000", block)
        self.assertIn("Receptionist: Heidi T.", block)
        self.assertNotIn("Heidi T..", block)
        self.assertIn(intake.comment_marker(lead), block)
        self.assertNotIn("Owner has", block)

    def test_multi_property_note(self):
        block = intake.build_comment(sample_lead(), [{"property_id": "1"}, {"property_id": "2"}])
        self.assertIn("Owner has 2 properties in the CRM (1, 2)", block)

    def test_append_keeps_existing(self):
        self.assertEqual(intake.append_comment("old note", "new"), "old note\n\nnew")
        self.assertEqual(intake.append_comment("", "new"), "new")
        self.assertEqual(intake.append_comment(None, "new"), "new")


class NoteTests(unittest.TestCase):
    """The 2.0 Record Note is HTML (the COMMENTS tab renders it as such):
    one paragraph per question with the answer on the line below."""

    def test_note_has_every_qa_and_marker(self):
        lead = sample_lead()
        note = intake.build_note(lead, [{"property_id": "10884"}])
        paras = note.split("\n")
        self.assertTrue(all(p.startswith("<p>") and p.endswith("</p>") for p in paras))
        self.assertTrue(paras[0].startswith("<p><strong>PATLive seller call 09/29/2026 12:24:29 PM</strong><br>Letter ref 9251 - Wayne Wagner"))
        self.assertIn("Callback: +1 (218) 280-0901 | Caller ID: +12182800901", paras[0])
        for question, answer in lead.answers:
            if question.lower() != "caller name":
                self.assertIn(f"<p><strong>{question.rstrip(':')}</strong><br>{answer or '-'}</p>", paras)
        self.assertIn("<p><strong>Comments</strong><br>-</p>", paras)  # the form's "Comments::" label loses its stray colon
        self.assertTrue(paras[-1].startswith("<p>Receptionist: Heidi T.<br>Message: https://flex.patlive.com/"))
        self.assertIn(intake.comment_marker(lead), paras[-1])
        self.assertNotIn("Owner has", note)
        self.assertLessEqual(len(note), intake.NOTE_MAX_CHARS)

    def test_note_escapes_html_in_answers(self):
        lead = sample_lead()
        lead.answers.append(("Anything else?", "Fence <north> & south"))
        note = intake.build_note(lead, [{"property_id": "1"}])
        self.assertIn("<p><strong>Anything else?</strong><br>Fence &lt;north&gt; &amp; south</p>", note)

    def test_note_multi_property_line(self):
        note = intake.build_note(sample_lead(), [{"property_id": "1"}, {"property_id": "2"}])
        self.assertIn("<p>Owner has 2 properties in the CRM (1, 2); same note on each.</p>", note)

    def test_note_truncates_whole_paragraphs_but_keeps_marker(self):
        lead = sample_lead()
        lead.answers.append(("Any other information?", "x" * 6000))
        note = intake.build_note(lead, [{"property_id": "1"}])
        self.assertLessEqual(len(note), intake.NOTE_MAX_CHARS)
        paras = note.split("\n")
        self.assertTrue(all(p.startswith("<p>") and p.endswith("</p>") for p in paras))
        self.assertEqual(paras[-2], "<p>[truncated]</p>")
        self.assertNotIn("xxxx", note)  # the oversized paragraph is dropped whole, never cut mid-tag
        self.assertTrue(note.startswith("<p><strong>PATLive seller call"))
        self.assertIn(intake.comment_marker(lead), paras[-1])


class NoteReformatTests(unittest.TestCase):
    def test_plain_text_detection(self):
        self.assertTrue(intake.note_is_plain_text("PATLive seller call ...\nline"))
        self.assertTrue(intake.note_is_plain_text(""))
        self.assertTrue(intake.note_is_plain_text(None))
        self.assertFalse(intake.note_is_plain_text("<p>hand edited</p>"))
        self.assertFalse(intake.note_is_plain_text("  <p><strong>PATLive</strong></p>"))


class PayloadTests(unittest.TestCase):
    PROP = {
        "property_id": "10884", "property_type": "Land", "property_status": "Mailed Letter 1",
        "owner_id": "9251", "caller_first_name": "Wayne", "caller_last_name": "Wagner",
        "property_comment": "", "property_acres": "5.1",
    }

    def test_advance_to_pending_research(self):
        p = intake.update_payload(self.PROP, "c", advance_status=True)
        self.assertEqual(p, {
            "p_id": "10884", "p_type": "Land", "p_status": "3", "or_id": "9251",
            "or_fname": "Wayne", "or_lname": "Wagner", "p_comments": "c",
        })

    def test_blank_caller_names_omitted(self):
        prop = dict(self.PROP, caller_first_name="", caller_last_name="")
        p = intake.update_payload(prop, "c", advance_status=True)
        self.assertNotIn("or_fname", p)
        self.assertNotIn("or_lname", p)
        self.assertEqual(p["or_id"], "9251")

    def test_later_stage_keeps_status(self):
        prop = dict(self.PROP, property_status="Offers Sent")
        self.assertNotIn("Offers Sent", set()) 
        self.assertIn("Offers Sent", intake.LATER_OR_EQUAL_STAGES)
        p = intake.update_payload(prop, "c", advance_status=False)
        self.assertEqual(p["p_status"], "4")

    def test_unknown_later_status_raises(self):
        prop = dict(self.PROP, property_status="Something New")
        with self.assertRaises(RuntimeError):
            intake.update_payload(prop, "c", advance_status=False)
        # but advancing an unknown early stage is fine
        self.assertEqual(intake.update_payload(prop, "c", advance_status=True)["p_status"], "3")

    def test_unexpected_changes(self):
        before = dict(self.PROP)
        after = dict(self.PROP, property_status="Pending Preliminary Research",
                     property_comment="x", update_time="1")
        self.assertEqual(intake.unexpected_changes(before, after), {})
        after["property_acres"] = ""
        self.assertEqual(set(intake.unexpected_changes(before, after)), {"property_acres"})


class ProcessTests(unittest.TestCase):
    """process_lead against a fake client: multi-property owner, idempotency."""

    class FakeClient:
        def __init__(self, props):
            self.props = {p["property_id"]: dict(p) for p in props}
            self.posts = []

        def properties_for_owner(self, oid):
            return [dict(p) for p in self.props.values() if p["owner_id"] == oid]

        def get_property(self, pid):
            return dict(self.props[pid])

        def post_property(self, payload):
            self.posts.append(payload)
            p = self.props[payload["p_id"]]
            p["property_comment"] = payload["p_comments"]
            p["property_status"] = {v: k for k, v in intake.STATUS_NAME_TO_POST.items()}[payload["p_status"]]
            return {"status": "Success"}

    class FakeNotes:
        """Stand-in for IDv2Client: notes keyed by property id."""

        def __init__(self, existing=None):
            self.notes = {pid: list(ns) for pid, ns in (existing or {}).items()}
            self.posts = []
            self._next = 100

        def notes_for_property(self, pid):
            return list(self.notes.get(pid, []))

        def add_note(self, pid, text):
            self._next += 1
            note = {"n_id": self._next, "p_id": int(pid), "n_description": text}
            self.notes.setdefault(pid, []).append(note)
            self.posts.append((pid, text))
            return note

    def setUp(self):
        intake.PACE_SECONDS = 0
        self._sem = intake.update_semantics_verified
        intake.update_semantics_verified = lambda: True

    def tearDown(self):
        intake.update_semantics_verified = self._sem

    def props(self):
        base = dict(PayloadTests.PROP)
        return [
            base,
            dict(base, property_id="10885", property_status="Prospect", property_comment="prior note"),
            dict(base, property_id="10886", property_status="Offers Sent"),
        ]

    def test_all_owner_properties_updated_once(self):
        client = self.FakeClient(self.props())
        msg = intake.lead_from_eml(FIXTURE)
        out = intake.process_lead(client, msg, dry_run=False)
        self.assertEqual(out.action, "applied")
        self.assertEqual(out.property_ids, ["10884", "10885", "10886"])
        statuses = {pid: p["property_status"] for pid, p in client.props.items()}
        self.assertEqual(statuses, {
            "10884": "Pending Preliminary Research",
            "10885": "Pending Preliminary Research",
            "10886": "Offers Sent",  # never regressed
        })
        self.assertTrue(client.props["10885"]["property_comment"].startswith("prior note\n\n[PATLive"))
        self.assertIn("Owner has 3 properties", client.props["10884"]["property_comment"])
        # second pass is a no-op thanks to the marker in the comment
        again = intake.process_lead(client, msg, dry_run=False)
        self.assertEqual(again.action, "already-applied")
        self.assertEqual(len(client.posts), 3)

    def test_unmatched_ref(self):
        client = self.FakeClient([])
        out = intake.process_lead(client, intake.lead_from_eml(FIXTURE), dry_run=False)
        self.assertEqual(out.action, "unmatched")
        self.assertEqual(client.posts, [])

    def test_dry_run_writes_nothing(self):
        client = self.FakeClient(self.props())
        notes = self.FakeNotes()
        out = intake.process_lead(client, intake.lead_from_eml(FIXTURE), dry_run=True, notes=notes)
        self.assertEqual(out.action, "dry-run")
        self.assertEqual(out.property_ids, ["10884", "10885", "10886"])
        self.assertEqual(client.posts, [])
        self.assertEqual(notes.posts, [])

    def test_notes_added_once_per_property(self):
        client = self.FakeClient(self.props())
        notes = self.FakeNotes()
        msg = intake.lead_from_eml(FIXTURE)
        out = intake.process_lead(client, msg, dry_run=False, notes=notes)
        self.assertEqual(out.action, "applied")
        self.assertEqual([pid for pid, _ in notes.posts], ["10884", "10885", "10886"])
        marker = intake.comment_marker(intake.extract_lead(msg))
        self.assertTrue(all(marker in text for _, text in notes.posts))
        self.assertIn("Owner has 3 properties", notes.posts[0][1])
        # second pass: comment marker and note marker both present -> nothing
        again = intake.process_lead(client, msg, dry_run=False, notes=notes)
        self.assertEqual(again.action, "already-applied")
        self.assertEqual(len(client.posts), 3)
        self.assertEqual(len(notes.posts), 3)

    def test_backfill_adds_only_the_note(self):
        """Records the cron already commented (before 2.0 notes existed) get the
        note and no second legacy write."""
        client = self.FakeClient(self.props())
        msg = intake.lead_from_eml(FIXTURE)
        intake.process_lead(client, msg, dry_run=False)  # legacy-only pass, notes=None
        self.assertEqual(len(client.posts), 3)
        notes = self.FakeNotes({"10885": [{"n_id": 1, "n_description": "unrelated note"}]})
        out = intake.process_lead(client, msg, dry_run=False, notes=notes)
        self.assertEqual(out.action, "applied")
        self.assertEqual(out.property_ids, ["10884", "10885", "10886"])
        self.assertEqual(len(client.posts), 3)  # no new legacy writes
        self.assertEqual([pid for pid, _ in notes.posts], ["10884", "10885", "10886"])
        # and a property whose note already carries the marker is left alone
        out2 = intake.process_lead(client, msg, dry_run=False, notes=notes)
        self.assertEqual(out2.action, "already-applied")
        self.assertEqual(len(notes.posts), 3)

    def test_note_failure_is_an_error_after_comment_landed(self):
        client = self.FakeClient(self.props())
        notes = self.FakeNotes()
        notes.add_note = lambda pid, text: {"n_id": 5, "n_description": "wrong"}
        out = intake.process_lead(client, intake.lead_from_eml(FIXTURE), dry_run=False, notes=notes)
        self.assertEqual(out.action, "error")
        self.assertIn("note did not land", out.detail)
        self.assertEqual(len(client.posts), 1)  # halted on the first property


if __name__ == "__main__":
    unittest.main()
