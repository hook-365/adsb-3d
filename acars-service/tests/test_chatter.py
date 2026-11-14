"""chatter.is_chatter: human-typed ACARS vs machine reports.

Bodies are modelled on real traffic (line-wrapped mid-word, typos and all).
"""
import pytest

from chatter import chatter_score, is_chatter

HUMAN = [
    ("30", "051230  GRB  MSP3\n        A D\nGOOD MORROW 9C SEAT WILL NOT STAY UPRIGHT. CAN MX PLS MEET AT GATE B14"),
    ("5Z", "OS KDFW /FTM\nTHANKS ANY CHANCE YOU\nCAN WORK A GATE FOR\nUS THAT WILL BE EMPTY"),
    ("80", "3J01 DSPTCH 0031/31 KJFK/KSEA .N969AK\nDO U HAVE A FINAL 4 THE\nDUCKS NU GAME. TXS"),
    ("81", "HI. GATE PLS. THANKS.\n"),
    ("84", "OK THANK YOU\n"),
    ("4R", "C311           2WAS SMOOTH NOW LIGHT CHOP"),
    ("80", "3801 MTCRP  0023/03 KJFK/KSEA .N431AS\nLAV G TOILET CLOGGED"),
    ("81", "/CANUOCZ.EST ENTER EDTO AT 0223Z\nPLS MNT EDTO ALTN WX\n"),
    # Terse write-ups: few listed words, but a run of real ones.
    ("27", "192027 KEWR KMSP6\nCAPTAINS LUMBAR KNOB\nDOES NOT WORK\n"),
    ("30", "100030 TJSJ KMSP6\nD      \nBACKLIGHTING ON LOWER\nPORTION OF ELECTRICAL\nSECTION OF OVERHEAD\nPANEL INOP"),
    ("30", "070230  MSP  GRB3\n        A\n4B XPOSING PVTS TO FAS. COPS MTG  US AT GATTE"),
    ("30", "DSPTCH\nacknowledged...thanks"),
]

MACHINE = [
    ("32", "APR,V03,CX 90  20261007 2,PANC,KORD,N045.127,W089.185,32939, 167"),
    ("16", "LAT N 44.837/LON W 089.303\n 161/329/0933"),
    ("80", "3C01 POSWX  0568/05 KJFK/KMSP .N833SY\n/POS CEWDA          /OVR 1907\n/ALT 380/FOB 0100/MCH 790/SAT -51\n/WND 281031/TRB SMOOTH  /SKY UNDERCAST"),
    ("80", "3N01 POSRPT 0388/05 ZSPD/KDTW .N519DN\n/POS N45043W089026/ALT 410/MCH 850/FOB 0302\n/TME 1420/WND 272 019/OAT -054/TAS 0490/ETA 1506"),
    ("5Z", "/C3 GATE REQ       \nKGPI KCLE 21 192000 3854 ---- ---- ---- ----"),
    ("5Z", "OS KMSP /ALT00001606"),
    ("39", "090239  MSP  GRB3\n0226 N                         \n                   6\n"),
    ("24", "131824  MSP  HPN0\nMSP HPN"),
    ("4T", "AGFSR AC0102/08/08/YVRYYZ/1750Z/236/4526.3N 8843.3W/350/      /0060/0086/M55/306091/0255/   /524/1441/1501/----/----"),
    ("HX", "RA FMT 43 MSP A14\n"),
    ("30", "091330 KLGA KMSP7\n/FN 2510\nA      \nCOPY"),
    ("83", "RJTT,KIAD,131216, 44.55,- 89.74,41001,249, 153.4, 28100"),
]


@pytest.mark.parametrize("label,text", HUMAN)
def test_human_messages_are_chatter(label, text):
    assert is_chatter(label, text), chatter_score(text)


@pytest.mark.parametrize("label,text", MACHINE)
def test_machine_reports_are_not(label, text):
    assert not is_chatter(label, text), chatter_score(text)


def test_machine_labels_never_match_whatever_the_body_says():
    # H1 status pages contain generated English.
    text = "#CFB 444\nADVISORY\nNO SMOKE ON\nTHANKS FOR THE UPDATE WE WILL ADVISE"
    assert is_chatter("30", text)
    assert not is_chatter("H1", text)


@pytest.mark.parametrize("text", [None, "", "   "])
def test_empty_bodies(text):
    assert not is_chatter("30", text)


def test_missing_label_is_scored_on_text():
    assert is_chatter(None, "HI. GATE PLS. THANKS.")
