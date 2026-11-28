import json
import runpy
import unittest
from pathlib import Path

model = runpy.run_path(str(Path(__file__).resolve().parents[1]/"scripts/build-breach-coverage.py"))
signals = model["signals"]

class CoverageTest(unittest.TestCase):
    def test_impact_requires_damage_in_context(self):
        for title,expected in [
            ("해커, 고객 16만3,743명 개인정보 유출","대규모 유출"),
            ("Denmark Says Attackers Accessed CPR Data for 8.8 Million People","대규모 유출"),
            ("FBI Says North Korean Hackers Stole Over $400 Million in Crypto","거액 탈취"),
            ("시립병원 랜섬웨어 공격으로 전산망 중단","운영 중단"),
            ("기업용 이메일 서비스, 약 7,700만건 유출로 확대","대규모 유출"),
            ("Attacker Exploited Third-Party Service to Steal $388M","거액 탈취"),
            ("Cloud Backup Remains Offline After Security Incident","운영 중단"),
            ("통신사 해킹 의혹, 피해 규모 조사 중",None),
            ("회원 11만명 넘는 플랫폼 해킹, 일부 고객 개인정보 유출",None),
            ("기업망서 해킹도구 사용 217만건 탐지",None),
            ("검찰, 해킹 탈취 자산 27억달러 동결",None),
            ("Google Disrupts 1.3 Million-Device Android Botnet",None),
        ]:
            with self.subTest(title=title):
                flags=signals(title)
                if expected:
                    self.assertIn(expected, flags or [])
                else:
                    self.assertFalse(flags)

    def test_windows_and_raw_numerators(self):
        archive=json.loads(model["SEED"].read_text("utf-8"))
        weeks=model["summarize"](archive)["weeks"]
        self.assertEqual(len(weeks),17)
        for i,w in enumerate(weeks):
            self.assertEqual(model["stamp"](w["end"])-model["stamp"](w["start"]),model["WEEK"])
            if i:
                self.assertEqual(w["start"],weeks[i-1]["end"])
            rows=[r for r in archive["articles"] if w["start"]<=r[0]<w["end"]]
            selected=[r for r in rows if signals(r[2]) is not None]
            self.assertEqual(w["count"],len(selected))
            self.assertEqual(w["count"],sum(w["sources"].values()))
            self.assertEqual({r["url"] for r in w["severe"]},{r[3] for r in selected if signals(r[2])})
        with self.assertRaises(ValueError):
            model["summarize"]({**archive,"start":weeks[1]["start"]})
if __name__=="__main__":
    unittest.main()
