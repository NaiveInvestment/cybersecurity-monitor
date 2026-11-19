"""Translate public RSS titles locally. Input and output are UTF-8 JSON on stdio."""

import json
import os
import re
import sys
from decimal import Decimal

import ctranslate2
import sentencepiece
from huggingface_hub import snapshot_download
from lingua import Language, LanguageDetectorBuilder


# Helsinki-NLP OPUS-MT en-ko, CC BY 4.0. This CT2 conversion retains the original
# separate English and Korean vocabularies and does not execute remote code.
MODEL = "eskara1398/opus-mt-tc-big-en-ko-ct2"
REVISION = "c4722b722b477acb3635059af5e7aa0fc1769084"
FILES = ["model.bin", "config.json", "source.spm", "target.spm",
         "source_vocabulary.json", "target_vocabulary.json"]

SCALES = {"k": 10**3, "m": 10**6, "b": 10**9, "t": 10**12,
          "mn": 10**6, "bn": 10**9, "tn": 10**12,
          "thousand": 10**3, "million": 10**6, "billion": 10**9, "trillion": 10**12}
CURRENCIES = {"$": ("dollars", "달러"), "US$": ("dollars", "달러"), "USD": ("dollars", "달러"),
              "€": ("euros", "유로"), "EUR": ("euros", "유로"), "£": ("pounds", "파운드"),
              "GBP": ("pounds", "파운드"), "₩": ("won", "원"), "KRW": ("won", "원"),
              "CAD": ("Canadian dollars", "캐나다 달러"), "C$": ("Canadian dollars", "캐나다 달러")}
VALUE = r"\d+(?:,\d{3})*(?:\.\d+)?"
SCALE = r"(?:thousand|million|billion|trillion|mn|bn|tn|[kmbt])"
QUANTITY = re.compile(
    rf"(?<![\w.])(?:(?P<currency>US\$|C\$|USD|CAD|EUR|GBP|KRW|[$€£₩])\s*(?P<cash>{VALUE})(?:\s*(?P<cash_scale>{SCALE})\b)?"
    rf"|(?P<number>{VALUE})(?:\s*(?P<scale>{SCALE})\b(?:\s+(?P<currency_word>US dollars?|dollars?|euros?|pounds?|won)\b)?"
    rf"|\s*(?P<unit>percent\b|%|years?\b)|(?=\s+(?:types?\s+of\s+)?(?:crypto(?:currencies|currency)|networks?|accounts?|records?|"
    rf"users?|patients?|organizations?|companies|hospitals?|businesses|sites?|exchanges?|devices?|systems?|servers?|customers?|cards?|victims?)\b)))", re.I)


def korean_quantity(number):
    for unit, divisor in (("조", 10**12), ("억", 10**8), ("만", 10**4), ("", 1)):
        if number >= divisor or divisor == 1:
            text = format(number / divisor, ",f")
            if "." in text:
                text = text.rstrip("0").rstrip(".")
            return text + unit


def protect_quantities(title):
    # Neural models sometimes change the magnitude of financial abbreviations or
    # swap values between noun phrases. Keep each source value with its own unit.
    parts = []
    offset = 0
    for index, match in enumerate(QUANTITY.finditer(title)):
        parts.append(title[offset:match.start()])
        number = Decimal((match["cash"] or match["number"]).replace(",", ""))
        number *= SCALES.get((match["cash_scale"] or match["scale"] or "").lower(), 1)
        currency = CURRENCIES.get((match["currency"] or "").upper())
        if match["currency_word"]:
            currency = {"dollar": CURRENCIES["$"], "us dollar": CURRENCIES["$"],
                        "euro": CURRENCIES["€"], "pound": CURRENCIES["£"], "won": CURRENCIES["₩"]}[
                            match["currency_word"].lower().rstrip("s")]
        unit = (match["unit"] or "").lower()
        english, korean = currency or (("years", "년") if unit.startswith("year") else
                                       ("percent", "%") if unit else ("", ""))
        literal = korean_quantity(number) + ((" " if currency else "") + korean if korean else "")
        parts.append((str(796001 + index), english, literal))
        offset = match.end()
    parts.append(title[offset:])
    return parts


def masked_text(parts):
    return "".join(part if isinstance(part, str) else part[0] + (" " + part[1] if part[1] else "") for part in parts)


def restore_quantities(parts, translated):
    for marker, unit, literal in (part for part in parts if isinstance(part, tuple)):
        # Tolerate a thousands separator inserted in our reference number.
        tag = marker[:3] + ",?" + marker[3:]
        suffix = {"dollars": r"(?:미국\s*)?(?:달러|불|dollars?)", "Canadian dollars": r"(?:캐나다\s*)?(?:달러|dollars?)",
                  "euros": r"(?:유로|euros?)", "pounds": r"(?:파운드|pounds?)", "won": r"(?:원|won)",
                  "years": r"(?:년(?:간)?|years?)", "percent": r"(?:퍼센트|%|percent)"}.get(unit)
        pattern = re.compile((r"(?:[$€£₩]\s*)?" if unit else "") + r"(?<!\d)" + tag + r"(?!\d)"
                             + (r"(?:\s*" + suffix + ")?" if suffix else ""), re.I)
        translated, count = pattern.subn(literal, translated)
        if count != 1:
            return None
    return translated


def english_titles(titles):
    # A publisher's region also includes foreign-language coverage and does not
    # determine its language. Keep Korean headlines containing English brands.
    detector = LanguageDetectorBuilder.from_languages(
        Language.ENGLISH, Language.FRENCH, Language.SPANISH, Language.GERMAN,
        Language.ITALIAN, Language.PORTUGUESE, Language.DUTCH, Language.POLISH,
        Language.TURKISH, Language.INDONESIAN, Language.VIETNAMESE
    ).build()
    # English security headlines often consist of short brand names and verbs,
    # which a general-purpose language detector can mistake for another language.
    english_phrase = re.compile(r"\b(?:hit by|falls? victim to|targeted by|takes? .+ after|wins?:|"
                                r"crypto malware|systems? halts?|as (?:a |an )?hackers? |data (?:breach|leak) (?:at|hits)|"
                                r"[\w-]+-cyberattack/?$)", re.I)
    return [title for title in titles if re.search(r"[a-zA-Z]{2,}", title)
            and not re.search(r"[가-힣ぁ-ヿ一-鿿А-я]", title)
            and (english_phrase.search(title) or detector.detect_language_of(title) == Language.ENGLISH)]


def translate(titles):
    titles = english_titles(titles)
    if not titles:
        return {}
    try:
        directory = snapshot_download(MODEL, revision=REVISION, allow_patterns=FILES, local_files_only=True)
        # Interrupted downloads can leave a partial snapshot directory.
        if not all(os.path.isfile(os.path.join(directory, file)) for file in FILES):
            raise FileNotFoundError(directory)
    except (FileNotFoundError, OSError):
        directory = snapshot_download(MODEL, revision=REVISION, allow_patterns=FILES)
    source = sentencepiece.SentencePieceProcessor(model_file=os.path.join(directory, "source.spm"))
    target = sentencepiece.SentencePieceProcessor(model_file=os.path.join(directory, "target.spm"))
    translator = ctranslate2.Translator(directory, device="cpu", compute_type="int8",
                                        intra_threads=min(os.cpu_count() or 1, 4))
    def infer(texts):
        translations = translator.translate_batch([source.encode(text, out_type=str) + ["</s>"] for text in texts],
                                                  beam_size=3, max_decoding_length=128, no_repeat_ngram_size=3)
        return [target.decode(row.hypotheses[0]).strip() for row in translations]
    results = {}
    for start in range(0, len(titles), 32):
        batch = titles[start:start + 32]
        rows = [protect_quantities(title) for title in batch]
        for title, parts, translation in zip(batch, rows, infer([masked_text(row) for row in rows])):
            korean = restore_quantities(parts, translation)
            if korean is None:
                # Even a missing marker must not drop a source amount. Translate
                # the adjacent text independently and reinsert each literal.
                phrases = [p.strip() for p in parts if isinstance(p, str) and re.search(r"[a-z]", p, re.I)]
                fragments = dict(zip(phrases, infer(phrases))) if phrases else {}
                korean = " ".join((p[2] if isinstance(p, tuple) else fragments.get(p.strip(), p.strip()))
                                  for p in parts if p).strip()
            results[title] = korean if re.search(r"[가-힣]", korean) else ""
    return results


if __name__ == "__main__":
    titles = json.loads(sys.stdin.buffer.read())
    sys.stdout.buffer.write(json.dumps(translate(titles), ensure_ascii=False).encode("utf-8"))
