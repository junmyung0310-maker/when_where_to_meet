import json
import os
import re
import uuid
from typing import Dict, List, Optional, Any
from datetime import datetime

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)
ROOMS_FILE = os.path.join(DATA_DIR, "rooms.json")

def _load_all_rooms() -> Dict[str, Any]:
    if not os.path.exists(ROOMS_FILE):
        return {}
    try:
        with open(ROOMS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def _save_all_rooms(rooms: Dict[str, Any]) -> None:
    with open(ROOMS_FILE, "w", encoding="utf-8") as f:
        json.dump(rooms, f, ensure_ascii=False, indent=2)

def generate_time_slots(start_time: str, end_time: str) -> List[str]:
    """
    start_time, end_time (예: '09:00', '22:00') 사이의 30분 단위 슬롯 생성.
    """
    slots = []
    sh, sm = map(int, start_time.split(":"))
    eh, em = map(int, end_time.split(":"))
    
    cur_minutes = sh * 60 + sm
    end_minutes = eh * 60 + em
    
    while cur_minutes < end_minutes:
        h = cur_minutes // 60
        m = cur_minutes % 60
        slots.append(f"{h:02d}:{m:02d}")
        cur_minutes += 30
        
    return slots

def create_room(
    title: str, 
    dates: List[str], 
    time_start: str = "09:00", 
    time_end: str = "22:00",
    custom_id: Optional[str] = None
) -> Dict[str, Any]:
    rooms = _load_all_rooms()
    
    # 직관적인 방 주소(ID) 결정
    room_id = ""
    if custom_id and custom_id.strip():
        # 영문, 숫자, 하이픈, 언더스코어만 허용
        sanitized = re.sub(r'[^a-zA-Z0-9_\-]', '', custom_id.strip().lower())
        if sanitized and sanitized not in rooms:
            room_id = sanitized
            
    if not room_id:
        # 기억하기 쉬운 형태 (meet-xxxxxx)
        room_id = f"meet-{uuid.uuid4().hex[:6]}"
        while room_id in rooms:
            room_id = f"meet-{uuid.uuid4().hex[:6]}"
    
    # 시간 슬롯 생성
    time_slots = generate_time_slots(time_start, time_end)
    
    room_data = {
        "id": room_id,
        "title": title.strip() if title.strip() else "모임 일정 조율",
        "dates": sorted(dates),
        "time_start": time_start,
        "time_end": time_end,
        "time_slots": time_slots,
        "participants": {},  # name -> {name, is_required, available_slots: [...], origin, lat, lng, updated_at}
        "where_result": None,
        "created_at": datetime.now().isoformat()
    }
    
    rooms[room_id] = room_data
    _save_all_rooms(rooms)
    return room_data

def get_room(room_id: str) -> Optional[Dict[str, Any]]:
    rooms = _load_all_rooms()
    return rooms.get(room_id)

def save_participant_schedule(
    room_id: str, 
    name: str, 
    available_slots: List[str],
    origin: str = "",
    is_required: Optional[bool] = None
) -> Optional[Dict[str, Any]]:
    rooms = _load_all_rooms()
    if room_id not in rooms:
        return None
    
    room = rooms[room_id]
    name = name.strip()
    if not name:
        return None
        
    # 기존 필수 참석자 및 출발지 좌표 보존
    existing_p = room["participants"].get(name, {})
    if is_required is None:
        required_flag = existing_p.get("is_required", False)
    else:
        required_flag = bool(is_required)
        
    new_origin = origin.strip() if origin.strip() else existing_p.get("origin", "")
    lat = existing_p.get("lat")
    lng = existing_p.get("lng")
    if new_origin != existing_p.get("origin", ""):
        lat = None
        lng = None

    p_entry = {
        "name": name,
        "is_required": required_flag,
        "available_slots": available_slots,
        "origin": new_origin,
        "updated_at": datetime.now().isoformat()
    }
    if lat is not None and lng is not None:
        p_entry["lat"] = lat
        p_entry["lng"] = lng

    room["participants"][name] = p_entry
    _save_all_rooms(rooms)
    return room

def save_participant_origin(room_id: str, name: str, origin: str) -> Optional[Dict[str, Any]]:
    """
    참여자의 출발지(origin)를 저장. 출발지가 변경되면 기존 lat, lng 좌표 캐시를 초기화.
    """
    rooms = _load_all_rooms()
    if room_id not in rooms:
        return None
    room = rooms[room_id]
    if name in room.get("participants", {}):
        p = room["participants"][name]
        if p.get("origin") != origin.strip():
            p["origin"] = origin.strip()
            p.pop("lat", None)
            p.pop("lng", None)
            _save_all_rooms(rooms)
    return room

def save_where_result(room_id: str, result: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Where to Meet 계산 결과를 해당 모임 방에 영구 저장"""
    rooms = _load_all_rooms()
    if room_id not in rooms:
        return None
    rooms[room_id]["where_result"] = result
    _save_all_rooms(rooms)
    return rooms[room_id]

def update_required_participants(room_id: str, required_names: List[str]) -> Optional[Dict[str, Any]]:
    """
    모임 참여자 리스트에서 필수 참석자(VIP) 목록을 지정/갱신
    """
    rooms = _load_all_rooms()
    if room_id not in rooms:
        return None
        
    room = rooms[room_id]
    req_set = set(required_names)
    
    for p_name, p_data in room.get("participants", {}).items():
        p_data["is_required"] = (p_name in req_set)
        
    _save_all_rooms(rooms)
    return room

def calculate_group_summary(room: Dict[str, Any]) -> Dict[str, Any]:
    """
    그룹 참여자들의 가능한 시간대 통계 및 TOP 3 추천 시간대 계산
    """
    dates = room.get("dates", [])
    time_slots = room.get("time_slots", [])
    participants = room.get("participants", {})
    
    total_participants = len(participants)
    required_participants = [p["name"] for p in participants.values() if p.get("is_required")]
    total_required = len(required_participants)
    
    # 슬롯별 통계
    slot_stats = {}
    for d in dates:
        for t in time_slots:
            slot_key = f"{d}_{t}"
            available_users = []
            required_users_available = []
            
            for p_name, p_data in participants.items():
                if slot_key in p_data.get("available_slots", []):
                    available_users.append(p_name)
                    if p_name in required_participants:
                        required_users_available.append(p_name)
            
            slot_stats[slot_key] = {
                "date": d,
                "time": t,
                "count": len(available_users),
                "ratio": (len(available_users) / total_participants) if total_participants > 0 else 0,
                "available_users": available_users,
                "unavailable_users": [p for p in participants.keys() if p not in available_users],
                "all_required_available": (len(required_users_available) == total_required) if total_required > 0 else True,
                "required_count": len(required_users_available),
                "total_required": total_required
            }
            
    # 연속 블록 및 TOP 3 추천 계산
    top_recommendations = _find_top_recommendations(dates, time_slots, slot_stats, total_participants, total_required)
    
    return {
        "total_participants": total_participants,
        "required_participants": required_participants,
        "slot_stats": slot_stats,
        "top_recommendations": top_recommendations
    }

def _find_top_recommendations(dates, time_slots, slot_stats, total_participants, total_required):
    if total_participants == 0:
        return []
    
    candidate_blocks = []
    
    for d in dates:
        i = 0
        while i < len(time_slots):
            for block_len in [4, 3, 2, 1]:
                if i + block_len <= len(time_slots):
                    sub_slots = time_slots[i:i+block_len]
                    sub_keys = [f"{d}_{t}" for t in sub_slots]
                    
                    common_available = None
                    all_required_ok = True
                    min_count = 999999
                    
                    for k in sub_keys:
                        st = slot_stats[k]
                        if not st["all_required_ok" if "all_required_ok" in st else "all_required_available"]:
                            all_required_ok = False
                        u_set = set(st["available_users"])
                        if common_available is None:
                            common_available = u_set
                        else:
                            common_available = common_available.intersection(u_set)
                        if st["count"] < min_count:
                            min_count = st["count"]
                            
                    count = len(common_available) if common_available is not None else 0
                    if count > 0:
                        start_t = sub_slots[0]
                        last_t = sub_slots[-1]
                        lh, lm = map(int, last_t.split(":"))
                        end_minutes = lh * 60 + lm + 30
                        end_t = f"{end_minutes // 60:02d}:{end_minutes % 60:02d}"
                        
                        score = 0
                        if total_required > 0 and all_required_ok:
                            score += 1000
                        elif total_required > 0 and not all_required_ok:
                            score -= 500
                        score += count * 100
                        score += block_len * 10
                        
                        candidate_blocks.append({
                            "date": d,
                            "start_time": start_t,
                            "end_time": end_t,
                            "duration_minutes": block_len * 30,
                            "available_count": count,
                            "total_participants": total_participants,
                            "available_users": sorted(list(common_available)),
                            "all_required_available": all_required_ok,
                            "score": score
                        })
            i += 1
            
    candidate_blocks.sort(key=lambda x: (x["score"], x["available_count"], x["duration_minutes"]), reverse=True)
    
    top3 = []
    for cand in candidate_blocks:
        is_dup = False
        for chosen in top3:
            if cand["date"] == chosen["date"] and (
                (cand["start_time"] <= chosen["start_time"] < cand["end_time"]) or
                (chosen["start_time"] <= cand["start_time"] < chosen["end_time"])
            ):
                is_dup = True
                break
        if not is_dup:
            top3.append(cand)
            if len(top3) == 3:
                break
                
    if len(top3) < 3:
        for cand in candidate_blocks:
            if cand not in top3:
                top3.append(cand)
                if len(top3) == 3:
                    break
                    
    return top3
