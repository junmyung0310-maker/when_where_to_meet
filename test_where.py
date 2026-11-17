"""
Where to Meet 알고리즘 단위 테스트 (test_where.py)
외부 API 호출 없이 가짜(Mock) 데이터를 사용하여 rank_candidates() 및 공평성 계산 로직 검증.
"""
import unittest
from unittest.mock import patch
import where


class TestWhereAlgorithm(unittest.TestCase):

    def setUp(self):
        # 3명의 참여자 (위경도는 임의)
        self.participants_3 = [
            {"name": "김준명", "lat": 37.4979, "lng": 127.0276},
            {"name": "유한영", "lat": 37.5826, "lng": 127.0017},
            {"name": "이랑", "lat": 37.2657, "lng": 127.0001},
        ]
        # 2명의 참여자
        self.participants_2 = [
            {"name": "김준명", "lat": 37.4979, "lng": 127.0276},
            {"name": "유한영", "lat": 37.5826, "lng": 127.0017},
        ]
        # 4개의 후보 역
        self.candidate_stations = [
            {"name": "사당역", "lat": 37.4765, "lng": 126.9816},
            {"name": "강남역", "lat": 37.4979, "lng": 127.0276},
            {"name": "신도림역", "lat": 37.5087, "lng": 126.8913},
            {"name": "서울역", "lat": 37.5562, "lng": 126.9723},
        ]

    @patch("where.get_transit_minutes")
    def test_rank_candidates_3_participants_max_time_priority(self, mock_transit):
        """
        1순위 기준: 가장 오래 걸리는 사람의 시간(max_time)이 가장 짧은 역이 1위여야 함.
        사당역: [20, 30, 35] -> max 35
        강남역: [10, 40, 50] -> max 50
        신도림역: [25, 30, 32] -> max 32 (1위 후보!)
        서울역: [45, 15, 60] -> max 60
        """
        time_table = {
            ("사당역", "김준명"): 20, ("사당역", "유한영"): 30, ("사당역", "이랑"): 35,
            ("강남역", "김준명"): 10, ("강남역", "유한영"): 40, ("강남역", "이랑"): 50,
            ("신도림역", "김준명"): 25, ("신도림역", "유한영"): 30, ("신도림역", "이랑"): 32,
            ("서울역", "김준명"): 45, ("서울역", "유한영"): 15, ("서울역", "이랑"): 60,
        }

        def fake_transit(from_pt, to_pt, st_name=""):
            for (st, p_name), t in time_table.items():
                if st == st_name:
                    p = next((p for p in self.participants_3 if p["name"] == p_name), None)
                    if p and (p["lng"], p["lat"]) == from_pt:
                        return t
            return 99

        mock_transit.side_effect = fake_transit

        result = where.rank_candidates(self.candidate_stations, self.participants_3)
        self.assertEqual(len(result), 3)  # 상위 3곳
        self.assertEqual(result[0]["name"], "신도림역")
        self.assertEqual(result[0]["rank"], 1)
        self.assertEqual(result[0]["max_time"], 32)
        self.assertEqual(result[1]["name"], "사당역")
        self.assertEqual(result[1]["rank"], 2)
        self.assertEqual(result[1]["max_time"], 35)

    @patch("where.get_transit_minutes")
    def test_tie_breaking_diff_and_total(self, mock_transit):
        """
        동점 처리 검증:
        역A: [30, 30] -> max: 30, diff: 0, total: 60
        역B: [20, 30] -> max: 30, diff: 10, total: 50
        역C: [25, 30] -> max: 30, diff: 5, total: 55
        max_time이 30으로 모두 같을 때 diff가 가장 작은 역A가 1위, 그 다음 역C가 2위, 역B가 3위.
        """
        candidates = [
            {"name": "역B", "lat": 1.0, "lng": 1.0},
            {"name": "역A", "lat": 2.0, "lng": 2.0},
            {"name": "역C", "lat": 3.0, "lng": 3.0},
        ]
        time_table = {
            ("역A", "김준명"): 30, ("역A", "유한영"): 30,
            ("역B", "김준명"): 20, ("역B", "유한영"): 30,
            ("역C", "김준명"): 25, ("역C", "유한영"): 30,
        }

        def fake_transit(from_pt, to_pt, st_name=""):
            for (st, p_name), t in time_table.items():
                if st == st_name:
                    p = next((p for p in self.participants_2 if p["name"] == p_name), None)
                    if p and (p["lng"], p["lat"]) == from_pt:
                        return t
            return 99

        mock_transit.side_effect = fake_transit

        result = where.rank_candidates(candidates, self.participants_2)
        self.assertEqual(result[0]["name"], "역A")  # diff 0
        self.assertEqual(result[1]["name"], "역C")  # diff 5
        self.assertEqual(result[2]["name"], "역B")  # diff 10

    @patch("where.get_transit_minutes")
    def test_2_participants_scenario(self, mock_transit):
        """2명의 참여자만으로도 오류 없이 정상 계산되는지 검증"""
        candidates = [
            {"name": "중간역", "lat": 37.5, "lng": 127.0},
            {"name": "먼역", "lat": 37.1, "lng": 126.9},
        ]
        mock_transit.side_effect = lambda f, t, st="": 15 if st == "중간역" else 50

        result = where.rank_candidates(candidates, self.participants_2)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["name"], "중간역")
        self.assertEqual(result[0]["max_time"], 15)
        self.assertEqual(result[0]["diff"], 0)

    @patch("where.get_transit_minutes")
    def test_transit_none_handling(self, mock_transit):
        """특정 참여자의 이동 시간이 None인 경우 안전하게 처리되는지 검증"""
        candidates = [{"name": "오류역", "lat": 37.5, "lng": 127.0}]
        mock_transit.return_value = None

        result = where.rank_candidates(candidates, self.participants_2)
        self.assertEqual(result, [])  # 유효한 시간이 없으면 빈 리스트 반환


if __name__ == "__main__":
    unittest.main()
