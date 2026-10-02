#!/usr/bin/env python3
"""PATLive lead email -> Investment Dominator property comment + status.

Flow (one cron pass):
  1. Pull unprocessed PATLive lead emails for leads@ownaloha.land from Fastmail
     over JMAP (or read .eml files given on the command line).
  2. Parse the receptionist form: caller, callback number, the "little number on
     the bottom right of the letter" (= Investment Dominator owner id, shown in
     the CRM as the Letter Ref), and every question/answer pair.
  3. Look up every property under that owner (property_get.php?oid=<ref>).
  4. For each property: append a comment block to the property's Comments field
     and set the status to Pending Preliminary Research (never regressing a
     later stage). Nothing else on the record is touched.
  4b. Add a private Record Note with the full Q&A through the Investment
     Dominator 2.0 API (api.investmentdominator.com). The 2.0 interface shows
     Record Notes on the property's COMMENTS tab but never displays the legacy
     Comments field, so without this step the call is invisible to the operator.
  5. Mark the email processed (JMAP keyword) and record it in the local state
     file so it is never applied twice. Unmatched refs are recorded for the
     operator instead of guessed.

Stdlib only. See README.md next to this file for setup and the PRD at
specs/patlive-intake.md for the design.
"""

from __future__ import annotations

import argparse
import datetime as dt
import email
import email.policy
import html
import json
import logging
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from html.parser import HTMLParser

HERE = pathlib.Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent.parent
STATE_DIR = HERE / "state"
STATE_FILE = STATE_DIR / "state.json"
SEMANTICS_FILE = STATE_DIR / "update-semantics.json"
ID_CREDENTIALS_FILE = pathlib.Path(
    os.environ.get(
        "ID_CREDENTIALS_FILE",
        "/home/mazer/claude/followupdominator/.credentials/investment_dominator.env",
    )
)

LEADS_ADDRESS = os.environ.get("PATLIVE_LEADS_ADDRESS", "leads@ownaloha.land")
PATLIVE_FROM = os.environ.get("PATLIVE_FROM", "patlive.com")
SUBJECT_PREFIX = "Your message from PATLive"
PROCESSED_KEYWORD = "patlive-id-synced"
JMAP_SESSION_URL = "https://api.fastmail.com/jmap/session"
JMAP_USING = ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"]
DEFAULT_LOOKBACK_DAYS = 7
PACE_SECONDS = 1.0  # ID has no published rate limit; stay polite

# Investment Dominator 2.0 REST backend (the v2.investmentdominator.com UI).
# Record Notes live here as the "comments" resource; the legacy /my/api key is
# rejected, it needs the CRM user's email + password (JWT login, 1h access).
V2_API_BASE = os.environ.get("ID_V2_API_BASE", "https://api.investmentdominator.com/v1")
NOTE_MAX_CHARS = 4136  # the 2.0 Add Note form's limit
NOTE_STATUS_PRIVATE = "0"  # "1" = Public, which shows on the selling website once listed
NOTE_TYPE_ADMIN_ONLY = "0"  # "1" = Admin and Rep

TARGET_STATUS_NAME = "Pending Preliminary Research"
TARGET_STATUS_POST = "3"
# property_status name (get side) -> p_status value on post. Verified live
# 2026-08-03 (see followupdominator/api_reference_investment_dominator.md).
STATUS_NAME_TO_POST = {
    "Prospect": "1",
    "Mailed Letter 1": "2",
    "Pending Preliminary Research": "3",
    "Offers Sent": "4",
    "Open Escrow - Detailed Research": "5",
    "Complete/ Ready To Sell": "6",
    "Found Buyer - Open Escrow": "7",
    "FILE CLOSED": "11",
}
# Stages at or beyond the target: a seller call-in must never move these back.
LATER_OR_EQUAL_STAGES = {
    "Pending Preliminary Research",
    "Offers Sent",
    "Open Escrow - Detailed Research",
    "Complete/ Ready To Sell",
    "Found Buyer - Open Escrow",
    "FILE CLOSED",
}
# Fields a comment+status update is allowed to change on read-back. Anything
# else changing means the API replaced the record instead of merging.
EXPECTED_CHANGED_FIELDS = {
    "property_status",
    "property_comment",
    "update_time",
    "property_status_create_time",
    "property_status_last_updated",
}

log = logging.getLogger("patlive-intake")


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------


def _parse_env_file(path: pathlib.Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def project_env(name: str) -> str | None:
    """Env var first, then the project-root .env.local (nothing auto-loads it)."""
    if os.environ.get(name):
        return os.environ[name]
    return _parse_env_file(PROJECT_ROOT / ".env.local").get(name) or None


def id_credentials() -> tuple[str, str]:
    key = os.environ.get("ID_API_KEY")
    url = os.environ.get("ID_ACCOUNT_URL")
    if not (key and url):
        creds = _parse_env_file(ID_CREDENTIALS_FILE)
        key = key or creds.get("ID_API_KEY")
        url = url or creds.get("ID_ACCOUNT_URL")
    if not (key and url):
        raise SystemExit(
            f"Investment Dominator credentials missing: set ID_API_KEY/ID_ACCOUNT_URL "
            f"or provide {ID_CREDENTIALS_FILE}"
        )
    return key, url.rstrip("/")


def id_v2_credentials() -> tuple[str, str, str] | None:
    """(crm_id, username, password) for the 2.0 API, or None when not configured.

    Env ID_V2_USERNAME / ID_V2_PASSWORD / ID_CRM_ID first, then the shared
    credentials file. crm_id falls back to the last path segment of the
    account URL (e.g. .../rei-crm/crm-01444 -> crm-01444)."""
    creds = _parse_env_file(ID_CREDENTIALS_FILE)

    def get(name):
        return os.environ.get(name) or creds.get(name) or ""

    user, password = get("ID_V2_USERNAME"), get("ID_V2_PASSWORD")
    crm_id = get("ID_CRM_ID") or get("ID_ACCOUNT_URL").rstrip("/").rsplit("/", 1)[-1]
    if not (user and password and crm_id):
        return None
    return crm_id, user, password


# --------------------------------------------------------------------------
# Email parsing
# --------------------------------------------------------------------------


@dataclass
class LeadEmail:
    message_id: str
    subject: str
    received_at: str
    text: str
    html_body: str
    jmap_id: str | None = None


@dataclass
class Lead:
    letter_ref: str | None
    caller_name: str
    callback_phone: str
    caller_id: str
    message_date: str
    receptionist: str
    form_name: str
    patlive_number: str
    message_url: str
    answers: list[tuple[str, str]] = field(default_factory=list)
    message_id: str = ""

    def answer(self, *needles: str) -> str:
        """First answer whose question contains all the needles (case-insensitive)."""
        for question, value in self.answers:
            q = question.lower()
            if all(n.lower() in q for n in needles):
                return value
        return ""


class _LabelValueHTML(HTMLParser):
    """Collect <h5>label</h5><p>value</p> pairs from the PATLive HTML body."""

    def __init__(self) -> None:
        super().__init__()
        self.pairs: list[tuple[str, str]] = []
        self._tag: str | None = None
        self._buf: list[str] = []
        self._label: str | None = None

    def handle_starttag(self, tag, attrs):
        if tag in ("h5", "p"):
            self._tag = tag
            self._buf = []

    def handle_endtag(self, tag):
        if tag != self._tag:
            return
        text = _clean(" ".join(self._buf))
        if tag == "h5":
            self._label = text.rstrip(":").strip()
        elif tag == "p" and self._label is not None:
            self.pairs.append((self._label, text))
            self._label = None
        self._tag = None

    def handle_data(self, data):
        if self._tag:
            self._buf.append(data)


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def parse_label_values_text(text: str) -> list[tuple[str, str]]:
    """Parse the plain-text body into (label, value) pairs in document order.

    A label is a line ending in ':' (the Q&A questions end in '?:' and the
    free-text one ends in '::'). Its value is every following line up to the
    next blank line or label.
    """
    pairs: list[tuple[str, str]] = []
    label: str | None = None
    buf: list[str] = []

    def flush():
        nonlocal label, buf
        if label is not None:
            pairs.append((label, _clean(" ".join(buf))))
        label, buf = None, []

    for raw in text.splitlines():
        line = raw.strip()
        if line.endswith(":") and len(line) > 1:
            flush()
            label = line[:-1].strip()
            continue
        if not line:
            flush()
            continue
        if label is not None:
            buf.append(line)
    flush()
    return pairs


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def _first(pairs: list[tuple[str, str]], *labels: str) -> str:
    wanted = {l.lower() for l in labels}
    for label, value in pairs:
        if label.lower() in wanted:
            return value
    return ""


def extract_lead(msg: LeadEmail) -> Lead:
    pairs = parse_label_values_text(msg.text) if msg.text.strip() else []
    if not pairs and msg.html_body:
        parser = _LabelValueHTML()
        parser.feed(msg.html_body)
        pairs = parser.pairs

    # Header block and Q&A block both carry "Caller Name"; the Q&A block starts
    # at the "Questions and Answers" marker in text, or after the second
    # "Caller Name" in HTML. Take everything after the header's "Caller ID".
    qa_start = 0
    for i, (label, _) in enumerate(pairs):
        if label.lower() == "caller id":
            qa_start = i + 1
    answers = [(l, v) for l, v in pairs[qa_start:] if l.lower() != "questions and answers"]

    lead = Lead(
        letter_ref=None,
        caller_name=_first(pairs, "Caller Name"),
        callback_phone="",
        caller_id=_first(pairs, "Caller ID"),
        message_date=_first(pairs, "Date of Message"),
        receptionist=_first(pairs, "Receptionist"),
        form_name=_first(pairs, "Form Name"),
        patlive_number=_first(pairs, "Phone Number"),
        message_url="",
        answers=answers,
        message_id=msg.message_id,
    )
    ref_raw = lead.answer("little number")
    ref = _digits(ref_raw)
    lead.letter_ref = ref or None
    lead.callback_phone = lead.answer("good phone number") or lead.caller_id
    m = re.search(r"https://flex\.patlive\.com/receptionist/message/[0-9a-f-]+", msg.html_body or "")
    lead.message_url = m.group(0) if m else ""
    return lead


def lead_from_eml(path: pathlib.Path) -> LeadEmail:
    msg = email.message_from_bytes(path.read_bytes(), policy=email.policy.default)
    plain = msg.get_body(preferencelist=("plain",))
    htmlp = msg.get_body(preferencelist=("html",))
    return LeadEmail(
        message_id=(msg["Message-ID"] or path.name).strip(),
        subject=msg["Subject"] or "",
        received_at=msg["Date"] or "",
        text=plain.get_content() if plain else "",
        html_body=htmlp.get_content() if htmlp else "",
    )


# --------------------------------------------------------------------------
# Comment text
# --------------------------------------------------------------------------


def comment_marker(lead: Lead) -> str:
    """Stable token stored inside the comment so a re-run can detect it."""
    if lead.message_url:
        return lead.message_url.rsplit("/", 1)[-1]
    return lead.message_id.strip("<>")


def build_comment(lead: Lead, properties: list[dict]) -> str:
    def a(*needles):
        return lead.answer(*needles) or "-"

    road = a("road access")
    paved = lead.answer("paved or unpaved")
    if paved and paved != "-":
        road = f"{road} ({paved})"
    clear = a("free and clear")
    owe = lead.answer("how much do you owe")
    if owe:
        clear = f"{clear} (owes {owe})"

    lines = [
        f"[PATLive {lead.message_date}] Seller called in about letter ref {lead.letter_ref or '?'}"
        f" - {lead.caller_name or 'unknown caller'}.",
        f"Callback: {lead.callback_phone or '-'} | Caller ID: {lead.caller_id or '-'}",
        " | ".join(
            [
                f"Size: {a('size')}",
                f"Road access: {road}",
                f"Electricity: {a('electricity')}",
                f"Free and clear: {clear}",
                f"Owned: {a('how long have you owned')}",
                f"Owner on record: {a('owner on record')}",
                f"Asking: {a('looking to get')}",
            ]
        ),
        f"Other info: {a('other information')} | OK with mailed offer: {a('ok with you')}",
    ]
    comments = lead.answer("comments")
    if comments:
        lines.append(f"Comments: {comments}")
    if len(properties) > 1:
        ids = ", ".join(p.get("property_id", "?") for p in properties)
        lines.append(
            f"Owner has {len(properties)} properties in the CRM ({ids});"
            f" all set to {TARGET_STATUS_NAME} from this call."
        )
    tail = f"Receptionist: {(lead.receptionist or '-').rstrip('.')}."
    if lead.message_url:
        tail += f" Message: {lead.message_url}"
    else:
        tail += f" Email: {lead.message_id}"
    lines.append(tail)
    return "\n".join(lines)


def append_comment(existing: str, block: str) -> str:
    existing = (existing or "").rstrip()
    return f"{existing}\n\n{block}" if existing else block


def _p(*lines: str, bold_first: bool = False) -> str:
    """One HTML paragraph; lines are escaped and separated by <br>."""
    parts = [html.escape(l, quote=False) for l in lines]
    if bold_first:
        parts[0] = f"<strong>{parts[0]}</strong>"
    return "<p>" + "<br>".join(parts) + "</p>"


def build_note(lead: Lead, properties: list[dict]) -> str:
    """HTML Record Note for the 2.0 COMMENTS tab, laid out like the PATLive
    email: a header paragraph, then one paragraph per question with the
    answer on the line below it, then the receptionist and the PATLive link
    (which carries the marker). The 2.0 UI renders n_description as HTML, so
    plain newlines would collapse into one block. Paragraphs are joined with
    newlines only to keep the dry-run log readable. Whole Q&A paragraphs are
    dropped from the end to stay under NOTE_MAX_CHARS without losing the tail."""
    head = _p(
        f"PATLive seller call {lead.message_date}",
        f"Letter ref {lead.letter_ref or '?'} - {lead.caller_name or 'unknown caller'}",
        f"Callback: {lead.callback_phone or '-'} | Caller ID: {lead.caller_id or '-'}",
        bold_first=True,
    )
    body = [
        _p(q.rstrip(":"), a or "-", bold_first=True)
        for q, a in lead.answers
        if q.lower() != "caller name"
    ]
    if len(properties) > 1:
        ids = ", ".join(p.get("property_id", "?") for p in properties)
        body.append(_p(f"Owner has {len(properties)} properties in the CRM ({ids}); same note on each."))
    tail_lines = [f"Receptionist: {(lead.receptionist or '-').rstrip('.')}."]
    if lead.message_url:
        tail_lines.append(f"Message: {lead.message_url}")
    else:
        tail_lines.append(f"Email: {lead.message_id}")
    tail = _p(*tail_lines)

    text = "\n".join([head, *body, tail])
    if len(text) <= NOTE_MAX_CHARS:
        return text
    cut = _p("[truncated]")
    while body and len("\n".join([head, *body, cut, tail])) > NOTE_MAX_CHARS:
        body.pop()
    return "\n".join([head, *body, cut, tail])


# --------------------------------------------------------------------------
# Investment Dominator client
# --------------------------------------------------------------------------


class IDClient:
    def __init__(self, api_key: str, account_url: str):
        self._key = api_key
        self._base = f"{account_url}/my/api"

    def call(self, endpoint: str, **params: str) -> str:
        body = dict(params)
        body["key"] = self._key
        req = urllib.request.Request(
            f"{self._base}/{endpoint}",
            data=urllib.parse.urlencode(body).encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", "replace")
            raise RuntimeError(f"ID {endpoint} HTTP {e.code}: {text[:200]}") from None

    def _records(self, raw: str, table: str) -> list[dict]:
        if not raw.strip():
            raise RuntimeError(f"ID returned an empty body (corrupt record in window?)")
        data = json.loads(raw)
        status = str(data.get("status", ""))
        if status.startswith("Failed"):
            raise RuntimeError(f"ID {table}_get failed: {status}")
        rows = data.get(table)
        if rows in (None, "No Record Found"):
            return []
        return rows

    def properties_for_owner(self, owner_id: str) -> list[dict]:
        rows: list[dict] = []
        start = 0
        while True:
            page = self._records(
                self.call("property_get.php", oid=owner_id, start=str(start), range="100"),
                "property",
            )
            rows.extend(page)
            if len(page) < 100:
                return rows
            start += 100
            time.sleep(PACE_SECONDS)

    def get_property(self, property_id: str) -> dict | None:
        rows = self._records(self.call("property_get.php", id=property_id), "property")
        return rows[0] if rows else None

    def post_property(self, payload: dict[str, str]) -> dict:
        raw = self.call("property_post.php", **payload)
        data = json.loads(raw) if raw.strip() else {}
        status = str(data.get("status", ""))
        if not status.startswith("Success"):
            raise RuntimeError(f"ID property_post failed: {raw[:300]}")
        return data


class IDv2Client:
    """Minimal client for the 2.0 REST API: JWT login on first use, Record
    Notes read/write. Endpoint notes: followupdominator/api_reference_investment_dominator.md."""

    def __init__(self, crm_id: str, username: str, password: str):
        self._base = f"{V2_API_BASE}/{crm_id}"
        self._username = username
        self._password = password
        self._auth: str | None = None
        self.user_id: int | None = None

    def _request(self, method: str, path: str, body: dict | None = None, auth: bool = True):
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if auth:
            if self._auth is None:
                self.login()
            headers["Authorization"] = self._auth
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{self._base}{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw.strip() else {})
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", "replace")
            raise RuntimeError(f"ID v2 {method} {path} HTTP {e.code}: {text[:200]}") from None

    def login(self) -> None:
        status, data = self._request(
            "POST", "/login", {"username": self._username, "password": self._password}, auth=False
        )
        payload = data.get("data") or {}
        token = payload.get("access_token")
        if status != 200 or not token:
            raise RuntimeError(f"ID v2 login failed: HTTP {status} {str(data)[:200]}")
        self._auth = token  # already carries its "Bearer " prefix
        self.user_id = (payload.get("user") or {}).get("u_id")
        if not self.user_id:
            raise RuntimeError("ID v2 login response has no user id")

    def notes_for_property(self, property_id: str) -> list[dict]:
        _, data = self._request("GET", f"/comments/?p_id={property_id}&ordering=-n_created&limit=100")
        return data.get("results") or []

    def add_note(self, property_id: str, text: str) -> dict:
        if len(text) > NOTE_MAX_CHARS:
            raise RuntimeError(f"note for property {property_id} is {len(text)} chars (> {NOTE_MAX_CHARS})")
        if self._auth is None:
            self.login()  # n_uid comes from the login response; build the body after it
        status, data = self._request(
            "POST",
            "/comments/",
            {
                "p_id": int(property_id),
                "n_description": text,
                "n_status": NOTE_STATUS_PRIVATE,
                "n_type": NOTE_TYPE_ADMIN_ONLY,
                "n_title": "default",
                "n_uid": self.user_id,
            },
        )
        if status != 201 or not data.get("n_id"):
            raise RuntimeError(f"ID v2 note post failed: HTTP {status} {str(data)[:200]}")
        return data


    def update_note(self, note: dict, text: str) -> dict:
        """Replace a note's text in place (PUT needs the full record; only
        n_description and n_last_updated change on read-back)."""
        if len(text) > NOTE_MAX_CHARS:
            raise RuntimeError(f"note {note.get('n_id')} is {len(text)} chars (> {NOTE_MAX_CHARS})")
        body = {k: note[k] for k in ("p_id", "n_status", "n_type", "n_title", "n_uid") if k in note}
        body["n_description"] = text
        status, data = self._request("PUT", f"/comments/{note['n_id']}/", body)
        if status != 200 or (data.get("n_description") or "") != text:
            raise RuntimeError(f"ID v2 note update failed: HTTP {status} {str(data)[:200]}")
        return data


def note_is_plain_text(description: str) -> bool:
    """True for notes written before build_note emitted HTML (2026-10-02).
    Hand-edited notes come back from the UI editor as <p> blocks and are left alone."""
    return not (description or "").lstrip().startswith("<")


def update_payload(prop: dict, new_comment: str, advance_status: bool) -> dict[str, str]:
    """Minimal in-place update: the record key, the fields the API requires on
    every post (type, status, caller name), the owner link, and the comment."""
    current = prop.get("property_status", "")
    if advance_status:
        status_post = TARGET_STATUS_POST
    else:
        status_post = STATUS_NAME_TO_POST.get(current)
        if status_post is None:
            raise RuntimeError(
                f"property {prop.get('property_id')} has status {current!r} with no known post value"
            )
    payload = {
        "p_id": prop["property_id"],
        "p_type": prop.get("property_type") or "Land",
        "p_status": status_post,
        "or_id": prop.get("owner_id", ""),
        "or_fname": prop.get("caller_first_name", ""),
        "or_lname": prop.get("caller_last_name", ""),
        "p_comments": new_comment,
    }
    # Company/trust owners have empty caller names. The API merges (probe
    # verdict), so omit blanks rather than send empty strings.
    return {k: v for k, v in payload.items() if v != ""}


def unexpected_changes(before: dict, after: dict) -> dict[str, tuple]:
    diffs = {}
    for k in set(before) | set(after):
        if before.get(k) != after.get(k) and k not in EXPECTED_CHANGED_FIELDS:
            diffs[k] = (before.get(k), after.get(k))
    return diffs


# --------------------------------------------------------------------------
# Fastmail JMAP
# --------------------------------------------------------------------------


class JMAP:
    def __init__(self, token: str):
        self._token = token
        session = self._get(JMAP_SESSION_URL)
        self.api_url = session["apiUrl"]
        self.account_id = session["primaryAccounts"]["urn:ietf:params:jmap:mail"]

    def _get(self, url: str) -> dict:
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self._token}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())

    def request(self, method_calls: list) -> list:
        body = json.dumps({"using": JMAP_USING, "methodCalls": method_calls}).encode()
        req = urllib.request.Request(
            self.api_url,
            data=body,
            headers={
                "Authorization": f"Bearer {self._token}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())["methodResponses"]
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"JMAP HTTP {e.code}: {e.read()[:300]!r}") from None

    def fetch_unprocessed(self, since: dt.datetime, limit: int = 50,
                          include_processed: bool = False) -> list[LeadEmail]:
        conditions = [
            {"to": LEADS_ADDRESS},
            {"from": PATLIVE_FROM},
            {"subject": SUBJECT_PREFIX},
            {"after": since.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")},
        ]
        if not include_processed:
            conditions.append({"notKeyword": PROCESSED_KEYWORD})
        query = {
            "accountId": self.account_id,
            "filter": {"operator": "AND", "conditions": conditions},
            "sort": [{"property": "receivedAt", "isAscending": True}],
            "limit": limit,
        }
        get = {
            "accountId": self.account_id,
            "#ids": {"resultOf": "q", "name": "Email/query", "path": "/ids"},
            "properties": [
                "id", "messageId", "subject", "receivedAt", "from", "to",
                "textBody", "htmlBody", "bodyValues", "keywords",
            ],
            "fetchTextBodyValues": True,
            "fetchHTMLBodyValues": True,
            "maxBodyValueBytes": 500_000,
        }
        responses = self.request([["Email/query", query, "q"], ["Email/get", get, "g"]])
        emails = []
        for name, payload, _ in responses:
            if name == "error":
                raise RuntimeError(f"JMAP error: {payload}")
            if name != "Email/get":
                continue
            for e in payload["list"]:
                values = e.get("bodyValues", {})

                def text_of(parts):
                    return "\n".join(
                        values[p["partId"]]["value"] for p in parts if p.get("partId") in values
                    )

                emails.append(
                    LeadEmail(
                        message_id=(e.get("messageId") or [e["id"]])[0],
                        subject=e.get("subject") or "",
                        received_at=e.get("receivedAt") or "",
                        text=text_of(e.get("textBody", [])),
                        html_body=text_of(e.get("htmlBody", [])),
                        jmap_id=e["id"],
                    )
                )
        return emails

    def mark_processed(self, jmap_id: str) -> None:
        responses = self.request(
            [[
                "Email/set",
                {
                    "accountId": self.account_id,
                    "update": {jmap_id: {f"keywords/{PROCESSED_KEYWORD}": True}},
                },
                "s",
            ]]
        )
        for name, payload, _ in responses:
            if name == "error" or (name == "Email/set" and payload.get("notUpdated")):
                raise RuntimeError(f"JMAP mark failed: {payload}")


# --------------------------------------------------------------------------
# State
# --------------------------------------------------------------------------


def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"processed": {}, "unmatched": {}, "last_received_at": None}


def save_state(state: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=1, sort_keys=True))
    tmp.replace(STATE_FILE)


def update_semantics_verified() -> bool:
    """The first live property write is gated on probe_property_update.py having
    shown that a partial post MERGES (a full-replace API would wipe fields)."""
    if os.environ.get("PATLIVE_FORCE_WRITES") == "1":
        return True
    if not SEMANTICS_FILE.exists():
        return False
    return json.loads(SEMANTICS_FILE.read_text()).get("verdict") == "merge"


# --------------------------------------------------------------------------
# Processing
# --------------------------------------------------------------------------


@dataclass
class Outcome:
    message_id: str
    letter_ref: str | None
    property_ids: list[str]
    action: str  # applied | dry-run | unmatched | already-applied | error
    detail: str = ""


def process_lead(client: IDClient, msg: LeadEmail, *, dry_run: bool,
                 notes: IDv2Client | None = None, reformat_notes: bool = False) -> Outcome:
    """Apply one email. The legacy comment+status write and the 2.0 Record Note
    are each idempotent on the marker, so a re-run (or a backfill on a record
    that already has the comment) only adds what is missing."""
    lead = extract_lead(msg)
    if not lead.letter_ref:
        return Outcome(msg.message_id, None, [], "unmatched", "no letter ref in email")

    props = client.properties_for_owner(lead.letter_ref)
    if not props:
        return Outcome(msg.message_id, lead.letter_ref, [], "unmatched", "no property under that owner id")

    marker = comment_marker(lead)
    block = build_comment(lead, props)
    note_text = build_note(lead, props)
    touched: list[str] = []
    skipped: list[str] = []
    for prop in props:
        pid = prop["property_id"]
        need_comment = marker not in (prop.get("property_comment") or "")
        existing_notes = [
            n for n in (notes.notes_for_property(pid) if notes is not None else [])
            if marker in (n.get("n_description") or "")
        ]
        need_note = notes is not None and not existing_notes
        stale_notes = [n for n in existing_notes if note_is_plain_text(n.get("n_description"))] \
            if reformat_notes else []
        if not need_comment and not need_note and not stale_notes:
            skipped.append(pid)
            continue

        if need_comment:
            advance = prop.get("property_status") not in LATER_OR_EQUAL_STAGES
            payload = update_payload(prop, append_comment(prop.get("property_comment", ""), block), advance)
            if dry_run:
                log.info("DRY-RUN property %s (%s -> %s)\n%s", pid, prop.get("property_status"),
                         TARGET_STATUS_NAME if advance else "unchanged", json.dumps(payload, indent=1))
            else:
                if not update_semantics_verified():
                    return Outcome(
                        msg.message_id, lead.letter_ref, [], "error",
                        "property writes are locked until probe_property_update.py records verdict=merge",
                    )
                client.post_property(payload)
                time.sleep(PACE_SECONDS)
                after = client.get_property(pid) or {}
                bad = unexpected_changes(prop, after)
                if bad:
                    log.error("property %s: unexpected field changes after update: %s", pid, bad)
                    return Outcome(
                        msg.message_id, lead.letter_ref, touched, "error",
                        f"property {pid} changed unexpected fields {sorted(bad)}; halting. Restore from the log.",
                    )
                if marker not in (after.get("property_comment") or ""):
                    return Outcome(msg.message_id, lead.letter_ref, touched, "error",
                                   f"property {pid}: comment did not land")
                log.info("property %s: comment appended, status %s -> %s", pid,
                         prop.get("property_status"), after.get("property_status"))

        if need_note:
            if dry_run:
                log.info("DRY-RUN property %s: would add 2.0 Record Note (%d chars)\n%s",
                         pid, len(note_text), note_text)
            else:
                created = notes.add_note(pid, note_text)
                if marker not in (created.get("n_description") or ""):
                    return Outcome(msg.message_id, lead.letter_ref, touched, "error",
                                   f"property {pid}: 2.0 note did not land")
                log.info("property %s: 2.0 Record Note %s added", pid, created.get("n_id"))

        for stale in stale_notes:
            if dry_run:
                log.info("DRY-RUN property %s: would reformat plain-text note %s (%d -> %d chars)\n%s",
                         pid, stale.get("n_id"), len(stale.get("n_description") or ""), len(note_text), note_text)
            else:
                notes.update_note(stale, note_text)
                log.info("property %s: 2.0 Record Note %s reformatted as HTML", pid, stale.get("n_id"))

        touched.append(pid)
        if not dry_run:
            time.sleep(PACE_SECONDS)

    if not touched and skipped:
        return Outcome(msg.message_id, lead.letter_ref, skipped, "already-applied")
    return Outcome(msg.message_id, lead.letter_ref, touched, "dry-run" if dry_run else "applied",
                   f"skipped already-commented: {skipped}" if skipped else "")


def run(args: argparse.Namespace) -> int:
    api_key, account_url = id_credentials()
    client = IDClient(api_key, account_url)
    notes: IDv2Client | None = None
    if args.skip_notes:
        log.info("2.0 Record Notes disabled (--skip-notes)")
    else:
        v2 = id_v2_credentials()
        if v2:
            notes = IDv2Client(*v2)
        else:
            log.warning("ID_V2_USERNAME/ID_V2_PASSWORD not set: 2.0 Record Notes will NOT be written "
                        "(the 2.0 UI will not show these calls)")
    state = load_state()
    outcomes: list[Outcome] = []
    jmap: JMAP | None = None

    if args.eml:
        messages = [lead_from_eml(pathlib.Path(p)) for p in args.eml]
    else:
        token = project_env("FASTMAIL_API_TOKEN")
        if not token:
            log.error("FASTMAIL_API_TOKEN is not set (env or project-root .env.local)")
            return 2
        jmap = JMAP(token)
        since = None
        if state.get("last_received_at"):
            since = dt.datetime.fromisoformat(state["last_received_at"].replace("Z", "+00:00"))
            since -= dt.timedelta(days=1)  # overlap; keyword + state dedupe the rest
        if args.since:
            since = dt.datetime.fromisoformat(args.since).replace(tzinfo=dt.timezone.utc)
        if since is None:
            since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=args.lookback_days)
        messages = jmap.fetch_unprocessed(since, include_processed=args.reprocess)
        log.info("JMAP: %d %s PATLive email(s) since %s", len(messages),
                 "matching" if args.reprocess else "unprocessed", since.isoformat())

    for msg in messages:
        if msg.message_id in state["processed"] and not args.reprocess:
            log.info("skip %s: already in state file", msg.message_id)
            if jmap and msg.jmap_id and not args.dry_run:
                jmap.mark_processed(msg.jmap_id)
            continue
        try:
            outcome = process_lead(client, msg, dry_run=args.dry_run, notes=notes,
                                   reformat_notes=args.reformat_notes)
        except Exception as exc:  # one bad email must not block the rest
            log.exception("error processing %s", msg.message_id)
            outcome = Outcome(msg.message_id, None, [], "error", str(exc))
        outcomes.append(outcome)
        log.info("%s ref=%s properties=%s %s", outcome.action, outcome.letter_ref,
                 outcome.property_ids, outcome.detail)

        if args.dry_run:
            continue
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        if outcome.action in ("applied", "already-applied"):
            state["processed"][msg.message_id] = {
                "at": now, "letter_ref": outcome.letter_ref,
                "property_ids": outcome.property_ids, "subject": msg.subject,
            }
            if jmap and msg.jmap_id:
                jmap.mark_processed(msg.jmap_id)
        elif outcome.action == "unmatched":
            state["unmatched"][msg.message_id] = {
                "at": now, "letter_ref": outcome.letter_ref, "subject": msg.subject,
                "received_at": msg.received_at, "reason": outcome.detail,
            }
            if jmap and msg.jmap_id:
                jmap.mark_processed(msg.jmap_id)  # recorded for the operator; don't retry forever
        if msg.received_at:
            prev = state.get("last_received_at")
            state["last_received_at"] = max(prev, msg.received_at) if prev else msg.received_at
        save_state(state)

    errors = [o for o in outcomes if o.action == "error"]
    unmatched = [o for o in outcomes if o.action == "unmatched"]
    log.info("done: %d processed, %d unmatched, %d errors", len(outcomes), len(unmatched), len(errors))
    if unmatched:
        log.warning("UNMATCHED letter refs need a human: %s",
                    [(o.letter_ref, o.message_id) for o in unmatched])
    return 1 if errors else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--eml", nargs="*", help="process these raw .eml files instead of polling Fastmail")
    ap.add_argument("--dry-run", action="store_true", help="look up and print, write nothing anywhere")
    ap.add_argument("--since", help="ISO date/time (UTC) to search from, overrides state")
    ap.add_argument("--lookback-days", type=int, default=DEFAULT_LOOKBACK_DAYS)
    ap.add_argument("--reprocess", action="store_true",
                    help="ignore the processed ledger and the JMAP keyword (backfill); "
                         "the comment and note markers still make each write idempotent")
    ap.add_argument("--skip-notes", action="store_true",
                    help="do not write 2.0 Record Notes (legacy comment + status only)")
    ap.add_argument("--reformat-notes", action="store_true",
                    help="rewrite this lead's existing plain-text 2.0 notes in the current HTML layout "
                         "(hand-edited notes, which the UI stores as HTML, are left alone); use with --reprocess")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
