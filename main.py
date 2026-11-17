import os
import socket
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from dotenv import load_dotenv
import storage
import where

# 환경 변수 로드
load_dotenv()
KAKAO_JS_KEY = os.getenv("KAKAO_JS_KEY", "").strip()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")

os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(TEMPLATES_DIR, exist_ok=True)

app = FastAPI(title="When2Meet & Where2Meet", version="1.2.0")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATES_DIR)


def get_local_ip() -> str:
    """외부(로컬 LAN)에서 접속 가능한 현재 컴퓨터의 IP 주소를 반환"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip


class CreateRoomRequest(BaseModel):
    title: str
    dates: List[str]
    time_start: str = "09:00"
    time_end: str = "22:00"
    custom_id: Optional[str] = None


class SaveScheduleRequest(BaseModel):
    name: str
    available_slots: List[str]
    origin: Optional[str] = ""
    is_required: Optional[bool] = None


class UpdateRequiredRequest(BaseModel):
    required_names: List[str]


class SaveOriginRequest(BaseModel):
    name: str
    origin: str


class WhereRequest(BaseModel):
    purpose: str = "study"


@app.get("/api/network-info")
async def get_network_info():
    """다른 컴퓨터 공유를 위한 서버 IP 및 포트 정보 반환"""
    return {
        "local_ip": get_local_ip(),
        "port": 8000
    }


@app.get("/", response_class=HTMLResponse)
async def index_page(request: Request):
    """홈 화면: 모임 방 생성"""
    local_ip = get_local_ip()
    return templates.TemplateResponse(
        request=request, 
        name="index.html", 
        context={"local_ip": local_ip}
    )


@app.post("/api/rooms")
async def create_new_room(data: CreateRoomRequest):
    """새 모임 방 생성 API (직관적인 custom_id 지원)"""
    if not data.dates:
        raise HTTPException(status_code=400, detail="최소 하루 이상의 날짜를 선택해야 합니다.")
    
    room = storage.create_room(
        title=data.title,
        dates=data.dates,
        time_start=data.time_start,
        time_end=data.time_end,
        custom_id=data.custom_id
    )
    return {"success": True, "room": room}


# 직관적인 신규 주소: /meet/{room_id}
@app.get("/meet/{room_id}", response_class=HTMLResponse)
async def meet_page(room_id: str, request: Request):
    """직관적인 모임 방 화면: 일정 조율 및 Where to Meet 실제 지도/추천 화면"""
    room = storage.get_room(room_id)
    if not room:
        return RedirectResponse(url="/?error=room_not_found")
    local_ip = get_local_ip()
    return templates.TemplateResponse(
        request=request, 
        name="room.html", 
        context={
            "room": room, 
            "local_ip": local_ip,
            "kakao_js_key": KAKAO_JS_KEY
        }
    )


# 이전 /room/{room_id} 하위 호환성 유지 리다이렉트
@app.get("/room/{room_id}", response_class=HTMLResponse)
async def room_page_redirect(room_id: str):
    return RedirectResponse(url=f"/meet/{room_id}")


@app.get("/api/rooms/{room_id}")
async def get_room_data(room_id: str):
    """방 정보 및 종합 통계/TOP3 추천 조회 API"""
    room = storage.get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="모임 방을 찾을 수 없습니다.")
    
    summary = storage.calculate_group_summary(room)
    return {
        "success": True,
        "room": room,
        "summary": summary
    }


@app.post("/api/rooms/{room_id}/availability")
async def save_availability(room_id: str, data: SaveScheduleRequest):
    """참여자 가능 일정 저장 API (시간 선택에 집중)"""
    if not data.name.strip():
        raise HTTPException(status_code=400, detail="이름을 입력해주세요.")
    
    updated_room = storage.save_participant_schedule(
        room_id=room_id,
        name=data.name.strip(),
        available_slots=data.available_slots,
        origin=data.origin or "",
        is_required=data.is_required
    )
    
    if not updated_room:
        raise HTTPException(status_code=404, detail="모임 방을 찾을 수 없습니다.")
        
    summary = storage.calculate_group_summary(updated_room)
    return {
        "success": True,
        "message": f"'{data.name}'님의 일정이 성공적으로 저장되었습니다.",
        "room": updated_room,
        "summary": summary
    }


@app.post("/api/rooms/{room_id}/required-participants")
async def update_required_participants(room_id: str, data: UpdateRequiredRequest):
    """
    모임 참여자 리스트에서 필수 참석자(VIP) 일괄 지정/해제 API
    선택 즉시 종합 시간표 및 최적 시간대 TOP 3가 실시간으로 재계산됩니다.
    """
    updated_room = storage.update_required_participants(
        room_id=room_id,
        required_names=data.required_names
    )
    if not updated_room:
        raise HTTPException(status_code=404, detail="모임 방을 찾을 수 없습니다.")
        
    summary = storage.calculate_group_summary(updated_room)
    return {
        "success": True,
        "message": "필수 참석자 목록이 갱신되었습니다.",
        "room": updated_room,
        "summary": summary
    }


@app.post("/api/rooms/{room_id}/origin")
async def save_origin(room_id: str, data: SaveOriginRequest):
    """Where to Meet 출발지 업데이트 API"""
    room = storage.get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="방을 찾을 수 없습니다.")
        
    updated = storage.save_participant_origin(room_id, data.name, data.origin)
    if not updated:
        # 혹시 기존 participants에 없는 이름이면 기본 일정과 함께 등록
        storage.save_participant_schedule(
            room_id=room_id,
            name=data.name,
            available_slots=[],
            origin=data.origin.strip()
        )
    return {"success": True}


# =====================================================================
# Where to Meet (공평한 중간 장소 찾기) API
# =====================================================================

@app.post("/api/rooms/{room_id}/where")
async def calculate_where(room_id: str, data: WhereRequest):
    """
    Where to Meet 중간 지점 및 목적별 장소 계산 API:
    저장된 참여자들의 출발지를 기반으로 공평성 최적 역과 목적별 장소 산출 후 방에 저장.
    """
    room = storage.get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="방을 찾을 수 없습니다.")

    result = where.calculate_where_to_meet(room, purpose=data.purpose)
    # 계산 결과 및 갱신된 참여자 좌표(lat, lng) 저장
    storage.save_where_result(room_id, result)
    storage._save_all_rooms(storage._load_all_rooms())
    return result


@app.get("/api/rooms/{room_id}/where")
async def get_where(room_id: str):
    """Where to Meet 마지막 계산 결과 조회 API"""
    room = storage.get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="방을 찾을 수 없습니다.")
    
    where_res = room.get("where_result")
    if not where_res:
        return {"success": False, "message": "아직 계산된 중간 장소 결과가 없습니다."}
    return where_res


@app.get("/api/rooms/{room_id}/where/places")
async def get_places(
    room_id: str, 
    station: str = Query(..., description="지하철역 이름"),
    lat: float = Query(..., description="위도"),
    lng: float = Query(..., description="경도"),
    purpose: str = Query("study", description="모임 목적 (study, cafe, dinner, drink)")
):
    """특정 지하철역 주변의 모임 목적 맞춤형 추천 장소 반환 API"""
    room = storage.get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="방을 찾을 수 없습니다.")

    station_dict = {"name": station, "lat": lat, "lng": lng}
    places = where.search_places(station_dict, purpose=purpose)
    return {"success": True, "places": places}


if __name__ == "__main__":
    import uvicorn
    local_ip = get_local_ip()
    port = 8000
    print("\n" + "="*65)
    print("🚀 When2Meet & Where2Meet 서버 시작!")
    print(f"👉 내 컴퓨터 접속 주소:     http://localhost:{port}")
    print(f"🌐 다른 컴퓨터/스마트폰 접속: http://{local_ip}:{port}")
    print("="*65 + "\n")
    
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
