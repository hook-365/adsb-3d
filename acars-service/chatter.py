"""Spot the human-typed ACARS messages.

Most ACARS traffic is machine-generated: position reports, engine data,
link acknowledgements. A small share is crew and dispatchers typing to each
other in free text ("GATE PLS", ride reports, a broken lavatory). Nothing in
the protocol marks those, and the label only narrows it down (the free-text
labels are airline-specific and also carry structured reports), so this
scores the words: plain English has function words and pleasantries that
no machine format produces.

`is_chatter` is deliberately a heuristic. It is tuned to prefer missing a
terse two-word message over flagging machine reports.
"""
import re
from typing import Optional

# Labels whose bodies are never free text: H1 is the machine "message to/from
# terminal" envelope (position, engine and CPDLC payloads, whose English-
# looking status lines are generated), the rest are link management or
# binary/encoded formats.
MACHINE_LABELS = frozenset({"H1", "_d", "Q0", "SA", "BA", "B0", "B6", "B9", "MA", "37", "1L"})

# Pleasantries and conversational words: one is enough.
STRONG = frozenset("""
    THANKS THANK THX THKS THK TKS TXS TNX PLS PLEASE PLZ SORRY LOL HAHA HELLO
    MORNING AFTERNOON EVENING MORROW AWESOME GRACIAS APPRECIATE APPRECIATED
    CHEERS WONDERING ANYWAY ACTUALLY PROBABLY MAYBE HOPEFULLY PERFECT
""".split())

# Cabin, ride and ops talk. Each also turns up in structured reports
# ("/TRB SMOOTH"), so one alone is not enough.
TOPIC = frozenset("""
    LAV LAVS TOILET TOILETS CLOGGED FLUSH FLUSHING SINK WIFI SEAT SEATS PAX
    PASSENGER PASSENGERS WHEELCHAIR WHEELCHAIRS FA FAS CHOP CHOPPY SMOOTH
    BUMPY RIDE RIDES TURB TURBULENCE INOP BROKEN GATE PARKING MX MAINT
    COFFEE CATERING GAME SCORE FINAL CONFIRM ADVISE COPY ROGER WILCO
    DEICE DEICING DIVERT DIVERTING HOLD HOLDING DELAY DELAYED LATE EARLY
    MEDICAL SICK CREW CAPT CAPTAIN DISPATCH REROUTE POLICE COPS
""".split())

# English function words. Machine formats are fields and codes, so two or
# more distinct ones mean somebody typed a sentence.
FUNCTION = frozenset("""
    THE A AN WE YOU OUR US MY ME IT ITS THAT THIS THEY THEM THERE HERE
    IS ARE WAS WERE BE BEEN HAVE HAS HAD WILL WOULD CAN COULD SHOULD
    DO DOES DID NOT AND BUT OR IF SO JUST ANY SOME WITH FOR FROM ABOUT
    WHEN WHAT HOW WHY NOW THEN STILL ALSO VERY MORE THAN GOING GOT GET
    NEED LOOKING LOOKS BEFORE AFTER ONCE
""".split())

# Single letters and bare "A"/"US"-style tokens are everywhere in headers
# (runway "A", status flags), so function words count only when they are
# at least this long, or when the text reads as a sentence anyway.
_SHORT_OK = frozenset({"WE", "IS", "IT", "DO", "IF", "SO", "MY", "ME", "BE", "OR"})

_WORD = re.compile(r"[A-Za-z]+")
_VOWEL = re.compile(r"[AEIOUYaeiouy]")


def chatter_score(text: str) -> int:
    """Weighted count of conversational words in `text`."""
    words = {w.upper() for w in _WORD.findall(text)}
    strong = len(words & STRONG)
    topic = len(words & TOPIC)
    function = sum(1 for w in words & FUNCTION if len(w) >= 3 or w in _SHORT_OK)
    return 3 * strong + 2 * topic + function


def prose_words(text: str) -> int:
    """Word-like tokens (3+ letters, with a vowel) after the first line,
    which on every free-text label is a routing header."""
    body = text.split("\n", 1)[1] if "\n" in text else ""
    return sum(1 for w in _WORD.findall(body) if len(w) >= 3 and _VOWEL.search(w))


def is_chatter(label: Optional[str], text: Optional[str]) -> bool:
    """True when the message body looks typed by a person."""
    if not text or (label or "") in MACHINE_LABELS:
        return False
    score = chatter_score(text)
    if score >= 3:
        return True
    # Terse write-ups ("CAPTAINS LUMBAR KNOB DOES NOT WORK") carry few of the
    # listed words but read as a run of real words under the header, with
    # hardly any of the digits a report is made of.
    digits = sum(c.isdigit() for c in text.split("\n", 1)[-1])
    return score >= 2 and prose_words(text) >= 5 and digits <= 6
