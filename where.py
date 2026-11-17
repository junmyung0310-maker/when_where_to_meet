import os
import json
import math
import re
from typing import Dict, List, Optional, Tuple, Any
import requests
from dotenv import load_dotenv
from shapely.geometry import MultiPoint, Point

# .env 로드
load_dotenv()

KAKAO_REST_KEY = os.getenv("KAKAO_REST_KEY", "").strip()
ODSAY_API_KEY = os.getenv("ODSAY_API_KEY", "").strip()

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)
CACHE_FILE = os.path.join(DATA_DIR, "where_cache.json")


def _load_cache() -> Dict[str, Any]:
    if not os.path.exists(CACHE_FILE):
        return {}
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_cache(cache: Dict[str, Any]) -> None:
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """두 좌표 간의 직선 거리(미터) 계산"""
    r = 6371000  # 지구 반경 (미터)
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2.0) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c


def geocode(text: str) -> Optional[Tuple[float, float]]:
    """
    출발지 문자열(역/장소명 또는 주소)을 카카오 로컬 API로 검색하여 (경도 lng, 위도 lat) 반환.
    키워드 검색 실패 시 주소 검색으로 재시도.
    """
    if not KAKAO_REST_KEY or not text.strip():
        return None

    headers = {"Authorization": f"KakaoAK {KAKAO_REST_KEY}"}
    query = text.strip()

    # 1. 키워드 검색 시도
    try:
        url = "https://dapi.kakao.com/v2/local/search/keyword.json"
        res = requests.get(url, headers=headers, params={"query": query, "size": 1}, timeout=5)
        if res.status_code == 200:
            docs = res.json().get("documents", [])
            if docs:
                return float(docs[0]["x"]), float(docs[0]["y"])
    except Exception:
        pass

    # 2. 주소 검색 시도
    try:
        url = "https://dapi.kakao.com/v2/local/search/address.json"
        res = requests.get(url, headers=headers, params={"query": query, "size": 1}, timeout=5)
        if res.status_code == 200:
            docs = res.json().get("documents", [])
            if docs:
                return float(docs[0]["x"]), float(docs[0]["y"])
    except Exception:
        pass

    return None


def clean_subway_name(name: str) -> str:
    """
    지하철 역명 정규화:
    예: '사당역 2호선', '사당역 4호선', '강남역 신분당선' -> '사당역', '강남역'
    """
    cleaned = re.sub(
        r'[\s\(\)\[\]]*((\d+호선|신분당선|수인분당선|경의중앙선|공항철도|우이신설선|신림선|서해선|김포골드라인|경춘선|경강선|인천\d+호선|의정부경전철|용인에버라인)\b.*)',
        '',
        name
    ).strip()
    # 역으로 끝나지 않으면 역 붙이기
    if not cleaned.endswith("역") and "역" in name:
        base = name.split("역")[0].strip() + "역"
        return base
    return cleaned if cleaned else name


def find_candidate_stations(points: List[Tuple[float, float]]) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, float]]]:
    """
    참여자들의 출발 좌표 리스트 [(lng, lat), ...]로부터
    Shapely 영역(convex_hull.buffer(0.01))을 만들고
    Kakao 지하철역(SW8) 카테고리 검색을 통해 후보 역 목록(최대 6개)을 반환.
    반환값: (후보 역 목록, 중심점 {lat, lng})
    """
    if not points:
        return [], None

    # Shapely 좌표 순서: (x, y) = (lng, lat)
    multi_pt = MultiPoint(points)
    area = multi_pt.convex_hull.buffer(0.01)
    centroid = area.centroid
    center_lng = float(centroid.x)
    center_lat = float(centroid.y)
    center_dict = {"lat": center_lat, "lng": center_lng}

    if not KAKAO_REST_KEY:
        return [], center_dict

    headers = {"Authorization": f"KakaoAK {KAKAO_REST_KEY}"}
    url = "https://dapi.kakao.com/v2/local/search/category.json"

    collected_stations = {}  # clean_name -> {name, lat, lng, dist_from_center, in_area}

    # 반경을 3km -> 6km -> 12km -> 20km로 점진적 확장 탐색
    for radius in [3000, 6000, 12000, 20000]:
        for page in [1, 2, 3]:
            try:
                params = {
                    "category_group_code": "SW8",
                    "x": center_lng,
                    "y": center_lat,
                    "radius": radius,
                    "page": page,
                    "size": 15,
                    "sort": "distance"
                }
                res = requests.get(url, headers=headers, params=params, timeout=5)
                if res.status_code != 200:
                    break
                data = res.json()
                docs = data.get("documents", [])
                if not docs:
                    break

                for doc in docs:
                    st_name = clean_subway_name(doc.get("place_name", ""))
                    lng = float(doc["x"])
                    lat = float(doc["y"])
                    in_area = area.contains(Point(lng, lat))
                    dist = haversine_distance_meters(center_lat, center_lng, lat, lng)

                    if st_name not in collected_stations:
                        collected_stations[st_name] = {
                            "name": st_name,
                            "lat": lat,
                            "lng": lng,
                            "distance_from_center": dist,
                            "in_area": in_area
                        }
                    else:
                        # 이미 등록되었으나 이번 좌표가 중심점에 더 가깝다면 갱신
                        if dist < collected_stations[st_name]["distance_from_center"]:
                            collected_stations[st_name]["lat"] = lat
                            collected_stations[st_name]["lng"] = lng
                            collected_stations[st_name]["distance_from_center"] = dist
                            collected_stations[st_name]["in_area"] = in_area

                # 이미 영역 내 역이 6개 이상 모였으면 탐색 종료 가능
                in_area_count = sum(1 for s in collected_stations.values() if s["in_area"])
                if in_area_count >= 6:
                    break
            except Exception:
                break

        in_area_count = sum(1 for s in collected_stations.values() if s["in_area"])
        if in_area_count >= 6:
            break

    # 1. 영역 안의 역들 중 중심점에서 가까운 순으로 최대 6곳 선택
    in_area_stations = [s for s in collected_stations.values() if s["in_area"]]
    in_area_stations.sort(key=lambda s: s["distance_from_center"])

    if in_area_stations:
        return in_area_stations[:6], center_dict

    # 2. 영역 안에 역이 하나도 없으면 중심점에서 가장 가까운 역 6곳 선택
    all_stations = list(collected_stations.values())
    all_stations.sort(key=lambda s: s["distance_from_center"])
    return all_stations[:6], center_dict


def get_transit_minutes(
    from_point: Tuple[float, float], 
    to_point: Tuple[float, float],
    station_name: str = ""
) -> Optional[int]:
    """
    출발지 (from_lng, from_lat)에서 목적지 (to_lng, to_lat)까지의
    대중교통 이동 소요 시간(분)을 계산.
    캐시 파일(data/where_cache.json) 활용 및 근거리 도보 자동 처리.
    """
    from_lng, from_lat = from_point
    to_lng, to_lat = to_point

    cache = _load_cache()
    cache_key = f"{round(from_lng, 4)}_{round(from_lat, 4)}->{station_name or f'{round(to_lng, 4)}_{round(to_lat, 4)}'}"
    if cache_key in cache:
        return cache[cache_key]

    # 두 좌표 간 직선 거리 확인
    dist_meters = haversine_distance_meters(from_lat, from_lng, to_lat, to_lng)
    
    # 700m 이내로 너무 가까운 경우: 도보 이동 (분당 약 70m 기준, 최소 3분)
    if dist_meters <= 700:
        walk_minutes = max(3, int(round(dist_meters / 70.0)))
        cache[cache_key] = walk_minutes
        _save_cache(cache)
        return walk_minutes

    # ODsay API 호출
    if ODSAY_API_KEY:
        try:
            url = "https://api.odsay.com/v1/api/searchPubTransPathT"
            params = {
                "SX": from_lng,
                "SY": from_lat,
                "EX": to_lng,
                "EY": to_lat,
                "apiKey": ODSAY_API_KEY
            }
            res = requests.get(url, params=params, timeout=5)
            if res.status_code == 200:
                data = res.json()
                paths = data.get("result", {}).get("path", [])
                if paths and len(paths) > 0:
                    total_time = paths[0].get("info", {}).get("totalTime")
                    if total_time is not None:
                        total_time = int(total_time)
                        cache[cache_key] = total_time
                        _save_cache(cache)
                        return total_time
                
                # 만약 출발/도착지가 가까워 에러코드 -8이 반환된 경우
                error_info = data.get("error", {})
                if str(error_info.get("code")) == "-8" or "출/도착지" in str(error_info.get("msg", "")):
                    walk_minutes = max(3, int(round(dist_meters / 70.0)))
                    cache[cache_key] = walk_minutes
                    _save_cache(cache)
                    return walk_minutes
        except Exception:
            pass

    # ODsay 키가 없거나 호출 실패 시의 합리적 폴백:
    # 대중교통 기준 약 30km/h(분당 500m) + 대기/환승 10분 추정
    approx_minutes = max(5, int(round(10 + (dist_meters / 500.0))))
    cache[cache_key] = approx_minutes
    _save_cache(cache)
    return approx_minutes


def rank_candidates(
    candidates: List[Dict[str, Any]], 
    participants: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    각 후보 역에 대해 참여자별 소요 시간을 계산하고 공평성 기준에 따라 순위를 산정.
    공평성 기준:
    1순위: 가장 오래 걸리는 사람의 시간(max_time)이 가장 짧은 역
    2순위: 최대-최소 시간 차이(diff)가 작은 역
    3순위: 총 소요 시간 합계(total)가 작은 역
    상위 3개 역에 rank(1, 2, 3)를 매겨 반환.
    """
    if not candidates or not participants:
        return []

    scored_candidates = []

    for cand in candidates:
        cand_point = (cand["lng"], cand["lat"])
        times = {}
        valid_times = []

        for p in participants:
            p_name = p["name"]
            p_point = (p["lng"], p["lat"])
            minutes = get_transit_minutes(p_point, cand_point, cand["name"])
            times[p_name] = minutes
            if minutes is not None:
                valid_times.append(minutes)

        if not valid_times:
            continue

        max_t = max(valid_times)
        min_t = min(valid_times)
        diff_t = max_t - min_t
        total_t = sum(valid_times)

        scored_candidates.append({
            "name": cand["name"],
            "lat": cand["lat"],
            "lng": cand["lng"],
            "times": times,
            "max_time": max_t,
            "diff": diff_t,
            "total": total_t
        })

    # 정렬: max_time 오름차순 -> diff 오름차순 -> total 오름차순
    scored_candidates.sort(key=lambda c: (c["max_time"], c["diff"], c["total"]))

    # 상위 3곳 선정 및 rank 부여
    top3 = scored_candidates[:3]
    for idx, item in enumerate(top3):
        item["rank"] = idx + 1

    return top3


def search_places(station: Dict[str, Any], purpose: str = "study") -> List[Dict[str, Any]]:
    """
    선택된 지하철역 주변의 모임 목적 맞춤형 장소 검색 (거리순 상위 3곳 반환)
    purpose:
      - 'study': 스터디카페, 스터디룸
      - 'cafe': 카페 (CE7)
      - 'dinner': 음식점 (FD6)
      - 'drink': 주점/술집
    """
    if not KAKAO_REST_KEY or not station:
        return []

    lat = station["lat"]
    lng = station["lng"]
    headers = {"Authorization": f"KakaoAK {KAKAO_REST_KEY}"}

    places = []

    try:
        if purpose == "cafe":
            url = "https://dapi.kakao.com/v2/local/search/category.json"
            params = {
                "category_group_code": "CE7",
                "x": lng,
                "y": lat,
                "radius": 800,
                "size": 5,
                "sort": "distance"
            }
            res = requests.get(url, headers=headers, params=params, timeout=5)
            if res.status_code == 200:
                places = res.json().get("documents", [])

        elif purpose == "dinner":
            url = "https://dapi.kakao.com/v2/local/search/category.json"
            params = {
                "category_group_code": "FD6",
                "x": lng,
                "y": lat,
                "radius": 800,
                "size": 5,
                "sort": "distance"
            }
            res = requests.get(url, headers=headers, params=params, timeout=5)
            if res.status_code == 200:
                places = res.json().get("documents", [])

        elif purpose == "drink":
            url = "https://dapi.kakao.com/v2/local/search/keyword.json"
            params = {
                "query": "주점",
                "x": lng,
                "y": lat,
                "radius": 1000,
                "size": 5,
                "sort": "distance"
            }
            res = requests.get(url, headers=headers, params=params, timeout=5)
            if res.status_code == 200:
                places = res.json().get("documents", [])
            if len(places) < 3:
                params["query"] = "술집"
                res2 = requests.get(url, headers=headers, params=params, timeout=5)
                if res2.status_code == 200:
                    places.extend(res2.json().get("documents", []))

        else:  # study
            url = "https://dapi.kakao.com/v2/local/search/keyword.json"
            params = {
                "query": "스터디카페",
                "x": lng,
                "y": lat,
                "radius": 1200,
                "size": 5,
                "sort": "distance"
            }
            res = requests.get(url, headers=headers, params=params, timeout=5)
            if res.status_code == 200:
                places = res.json().get("documents", [])
            if len(places) < 3:
                params["query"] = "스터디룸"
                res2 = requests.get(url, headers=headers, params=params, timeout=5)
                if res2.status_code == 200:
                    places.extend(res2.json().get("documents", []))

    except Exception:
        pass

    # 중복 제거 및 거리순 상위 3곳 정리
    seen_ids = set()
    result = []
    for doc in places:
        doc_id = doc.get("id")
        if doc_id and doc_id in seen_ids:
            continue
        seen_ids.add(doc_id)

        try:
            dist_val = int(doc.get("distance", 0))
        except Exception:
            dist_val = 0

        result.append({
            "name": doc.get("place_name", "이름 없음"),
            "distance": dist_val,
            "address": doc.get("road_address_name") or doc.get("address_name", ""),
            "category": doc.get("category_name", ""),
            "url": doc.get("place_url", "")
        })

    result.sort(key=lambda p: p["distance"])
    return result[:3]


def calculate_where_to_meet(room: Dict[str, Any], purpose: str = "study") -> Dict[str, Any]:
    """
    모임 방 데이터(room)의 참여자 출발지들을 바탕으로
    Where to Meet 전체 플로우(좌표화 -> 후보역 -> 공평성 랭킹 -> 추천장소)를 실행.
    """
    warnings = []
    
    if not KAKAO_REST_KEY:
        warnings.append("카카오 REST API 키(KAKAO_REST_KEY)가 설정되지 않아 좌표 검색이 불가능합니다.")
    if not ODSAY_API_KEY:
        warnings.append("ODsay API 키(ODSAY_API_KEY)가 설정되지 않아 대중교통 이동시간이 직선거리 기반 추정치로 계산됩니다.")

    participants_data = room.get("participants", {})
    origins_result = []
    valid_participants = []

    # 1. 참여자별 출발지 좌표화
    for name, p in participants_data.items():
        origin_input = p.get("origin", "").strip()
        if not origin_input:
            continue

        lat = p.get("lat")
        lng = p.get("lng")

        # 기존 저장된 좌표가 없으면 geocode 수행
        if lat is None or lng is None:
            coords = geocode(origin_input)
            if coords:
                lng, lat = coords
                # room 참여자 정보에 좌표 저장
                p["lat"] = lat
                p["lng"] = lng
            else:
                origins_result.append({
                    "name": name,
                    "input": origin_input,
                    "lat": None,
                    "lng": None,
                    "found": False
                })
                warnings.append(f"'{name}'님의 출발지 '{origin_input}' 좌표를 찾을 수 없습니다.")
                continue

        origins_result.append({
            "name": name,
            "input": origin_input,
            "lat": lat,
            "lng": lng,
            "found": True
        })
        valid_participants.append({
            "name": name,
            "lat": lat,
            "lng": lng
        })

    # 유효 출발지 인원 검사 (2명 미만인 경우)
    if len(valid_participants) < 2:
        return {
            "success": False,
            "origins": origins_result,
            "candidates": [],
            "places": [],
            "warnings": warnings + ["출발지를 입력한 참여자가 최소 2명 이상이어야 중간 장소를 계산할 수 있습니다."]
        }

    # 2. 탐색 영역 및 후보 지하철역 추리기
    points = [(p["lng"], p["lat"]) for p in valid_participants]
    candidate_stations, center_point = find_candidate_stations(points)

    if not candidate_stations:
        return {
            "success": False,
            "origins": origins_result,
            "candidates": [],
            "places": [],
            "warnings": warnings + ["탐색 영역 내에서 후보 지하철역을 찾지 못했습니다."]
        }

    # 3. 공평성 기준 순위 산정
    ranked_candidates = rank_candidates(candidate_stations, valid_participants)

    if not ranked_candidates:
        return {
            "success": False,
            "origins": origins_result,
            "candidates": [],
            "places": [],
            "warnings": warnings + ["후보 역들의 대중교통 이동 시간을 계산할 수 없습니다."]
        }

    # 4. 1위 역 주변 목적별 추천 장소 검색
    top1_station = ranked_candidates[0]
    places = search_places(top1_station, purpose)

    return {
        "success": True,
        "purpose": purpose,
        "center": center_point,
        "origins": origins_result,
        "candidates": ranked_candidates,
        "places": places,
        "warnings": warnings
    }
