# When2Meet & Where2Meet (우리지금만나)

약속 시간 조율(When2Meet)과 최적의 대중교통 중간 장소 추천(Where2Meet)을 결합한 파이썬 기반 웹 서비스입니다.

---

## 🌐 접속 주소 및 네트워크 공유 안내

서버를 구동하면 `0.0.0.0:8000`으로 바인딩되어 **내 컴퓨터뿐만 아니라 같은 와이파이/네트워크에 있는 다른 컴퓨터, 노트북, 스마트폰**에서도 바로 접속할 수 있습니다.

### 1. 접속 주소 형식
- **내 컴퓨터 접속**: `http://localhost:8000`
- **다른 사람 컴퓨터/스마트폰 접속**: `http://<내-로컬-IP>:8000` (예: `http://10.221.142.35:8000`)
- **직관적인 모임 주소**:
  - 생성 시 원하는 링크 입력 가능: `http://<IP>:8000/meet/capstone-team`
  - 자동 생성 시: `http://<IP>:8000/meet/meet-a1b2c3`
  - *(기존 `/room/...`으로 접속해도 자동으로 `/meet/...`으로 안전하게 연결됩니다)*

### 2. 서버 실행 방법
프로젝트 디렉터리(`C:\programming\when_where_to_meet`)에서 아래 명령어를 실행합니다:

```bash
python main.py
# 또는 uv 사용 시
uv run main.py
```

---

## 🔑 환경 변수(.env) 및 API 설정 가이드

Where to Meet(공평한 중간 장소 추천) 기능을 원활히 사용하기 위해 프로젝트 루트에 `.env` 파일을 생성하고 아래 형식으로 API 키를 입력합니다.

### 1. `.env` 파일 작성 예시
```env
KAKAO_REST_KEY=카카오_REST_API_키
KAKAO_JS_KEY=카카오_JavaScript_키
ODSAY_API_KEY=ODsay_API_키
```

> [!NOTE]
> `.env` 파일이 없거나 키가 비어 있어도 서버는 정상 구동되며, Where 탭에 "API 키가 설정되지 않았습니다" 안내 배너가 표시됩니다.

### 2. Kakao Developers 필수 설정
1. [Kakao Developers](https://developers.kakao.com/)에서 애플리케이션 생성 후 앱 키 확인:
   - **REST API 키** → `KAKAO_REST_KEY`에 등록 (서버 좌표 변환, 역/장소 검색용)
   - **JavaScript 키** → `KAKAO_JS_KEY`에 등록 (브라우저 카카오 지도 SDK 렌더링용)
2. **카카오맵 사용 설정 ON (필수)**:
   - 좌측 메뉴 **[카카오맵]** → **[사용 설정]** 토글을 **ON**으로 활성화해야 지도와 검색 API가 정상 작동합니다.
   - *(무료 사용량은 계정에서 처음 카카오맵을 켠 앱 하나에만 제공되므로 팀 공용 앱 1개를 사용하는 것을 권장합니다.)*
3. **Web 플랫폼 사이트 도메인 등록 (필수)**:
   - 좌측 메뉴 **[플랫폼]** → **[Web]**에 아래 주소들을 등록합니다:
     ```text
     http://localhost:8000
     http://127.0.0.1:8000
     http://10.221.142.35:8000   (시연할 컴퓨터의 로컬 네트워크 IP)
     ```

### 3. ODsay LAB (대중교통 길찾기 API) 설정
1. [ODsay LAB](https://lab.odsay.com/)에서 개발자 회원가입 및 API 키 발급 → `ODSAY_API_KEY`에 등록.
2. 키 설정에 서버 IP나 주소를 등록하는 항목이 있을 경우 등록. 와이파이나 네트워크가 바뀌어 IP가 달라지면 인증 오류가 발생할 수 있습니다.

---

## 📋 핵심 기능 및 알고리즘 상세

### 1. When to Meet (약속 시간 조율)
- **30분 단위 드래그 시간표**: PC 마우스 및 모바일 손가락 터치 드래그 지원.
- **동적 VIP(필수 참석자) 지정**: 팀원 등록 후 체크박스로 필수 참석자를 실시간 지정/해제. VIP 만족 시간대 골드 테두리(⭐) 강조.
- **AI 최적 모임 시간 TOP 3 추천**: VIP 만족 여부, 참석 인원 수, 연속 시간 길이를 종합 점수화하여 상위 3개 구간 자동 도출.
- **실시간 호버 명단 & 동기화 스크롤**: 시간대 호버 시 가능/불가능 명단 안내, 참여자 이름 호버 시 해당 인원 가능 시간 하이라이트.

### 2. Where to Meet (공평한 최적 중간 장소 찾기) ★
- **출발지 좌표화 (Kakao Local API)**:
  - 각 팀원의 출발지 문자열(예: '강남역', '혜화역', 주소 등)을 카카오 키워드 검색(실패 시 주소 검색)으로 위/경도 좌표로 변환.
  - 좌표 변환 실패 시 해당 참여자만 안내 메시지와 함께 제외하고 나머지 인원으로 안전하게 계산.
- **탐색 영역 생성 (Shapely)**:
  - `MultiPoint([(lng, lat), ...]).convex_hull.buffer(0.01)` 방식을 적용하여 2명, 3명 이상 어떤 인원수에서도 중심점과 탐색 폴리곤 영역을 안정적으로 산출.
- **후보 지하철역 추출 (카테고리 SW8)**:
  - 중심점 기준 반경 3km → 6km → 12km → 20km로 확장 탐색하며, 탐색 영역 안의 역들 중 중심점에서 가까운 순으로 최대 6곳을 추림.
  - 호선 중복(예: '사당역 2호선', '사당역 4호선' → '사당역')을 정규화하여 하나로 통합.
- **공평성 랭킹 알고리즘 (Min-Max 시간 최소화)**:
  - **1순위**: 가장 오래 걸리는 사람의 시간(`max_time`)이 가장 짧은 역 (아무도 너무 멀리 오지 않도록 보장).
  - **2순위**: 최대-최소 시간 차이(`diff`)가 가장 작은 역.
  - **3순위**: 총 소요 시간 합계(`total`)가 가장 작은 역.
- **대중교통 이동 시간 계산 및 캐시**:
  - ODsay `searchPubTransPathT` API 연동. 근거리(700m 이내)는 도보(약 70m/분)로 자동 처리.
  - `(출발 좌표 -> 도착 역)` 이동 시간을 `data/where_cache.json`에 영구 캐싱하여 API 호출 수 최소화.
- **모임 목적별 추천 장소 TOP 3**:
  - 선택된 역 주변에서 스터디/회의(`study`), 카페/카공(`cafe`), 식사/회식(`dinner`), 뒤풀이/주점(`drink`) 목적에 맞춰 카카오 로컬 API로 거리순 상위 3곳 및 카카오맵 바로가기 링크 제공.
- **카카오 지도 시각화**:
  - 각 팀원의 출발지 핀(이름 오버레이), 추천 1위 역(강조 핀) 및 2·3위 역(보조 핀)을 표시하고 모든 핀이 보이도록 지도의 지도 영역(Bounds) 자동 맞춤.

---

## 📂 파일 구조 및 주요 함수 설명

```
C:\programming\when_where_to_meet/
├── main.py                     # FastAPI 서버 라우터 및 REST API 엔드포인트
├── where.py                    # Where to Meet 핵심 알고리즘 및 외부 API 연동 모듈
├── storage.py                  # 방/시간표/출발지/계산 결과 영구 저장 및 TOP 3 추천 알고리즘
├── test_where.py               # Where to Meet 공평성 랭킹 알고리즘 단위 테스트 (Mock 기반)
├── test_app.py                 # URL 및 필수 참석자 동적 흐름 통합 테스트
├── data/
│   ├── rooms.json              # 모임 및 일정 데이터 영구 저장 파일
│   └── where_cache.json        # 대중교통 이동 시간 로컬 캐시 파일
├── templates/
│   ├── index.html              # 방 생성 홈 화면
│   └── room.html               # When & Where 탭 및 카카오 지도 화면
└── static/
    ├── css/
    │   └── style.css           # 모던 & 반응형 디자인 스타일시트
    └── js/
        └── app.js              # 프론트엔드 전체 인터랙션 및 지도/차트 렌더링
```

### 📌 주요 파일별 핵심 함수 설명

#### `where.py`
- `geocode(text)`: 입력된 지명이나 주소를 카카오 키워드/주소 검색 API를 통해 `(lng, lat)` 좌표로 변환.
- `clean_subway_name(name)`: '사당역 2호선' 등 호선 정보가 포함된 역명을 '사당역'으로 정규화.
- `find_candidate_stations(points)`: Shapely Convex Hull 버퍼 영역 내에서 중심점 기준 카카오 카테고리(SW8) 검색을 거쳐 후보 역 최대 6곳 도출.
- `get_transit_minutes(from_point, to_point, station_name)`: ODsay 대중교통 길찾기 API를 호출하여 소요 시간(분)을 계산하며, `data/where_cache.json` 캐시 활용.
- `rank_candidates(candidates, participants)`: 후보 역별 참여자 소요 시간을 바탕으로 `max_time`, `diff`, `total` 기준 공평성 순위(1~3위) 산정.
- `search_places(station, purpose)`: 선택된 역 반경 내에서 목적(스터디, 카페, 식사, 주점)에 맞는 주변 장소 상위 3곳 검색.
- `calculate_where_to_meet(room, purpose)`: 좌표화부터 후보역 도출, 순위 산정, 장소 검색까지 Where to Meet 전체 프로세스를 총괄 실행.

#### `main.py`
- `POST /api/rooms/{room_id}/where`: 저장된 출발지 정보를 바탕으로 `where.calculate_where_to_meet`를 호출하고 결과를 방 데이터에 저장 및 반환.
- `GET /api/rooms/{room_id}/where`: 마지막으로 계산된 중간 장소 추천 결과 조회.
- `GET /api/rooms/{room_id}/where/places`: 특정 지하철역 주변의 목적별 장소를 실시간으로 재검색하여 반환.
- `POST /api/rooms/{room_id}/origin`: 참여자의 출발지 저장 및 좌표 캐시 관리.

#### `storage.py`
- `save_participant_origin(room_id, name, origin)`: 출발지 변경 시 기존 좌표 캐시를 초기화하며 안전하게 저장.
- `save_where_result(room_id, result)`: 중간 장소 계산 결과를 영구 저장.

#### `test_where.py`
- `test_rank_candidates_3_participants_max_time_priority`: 1순위 기준(`max_time` 최소)에 따라 가장 공평한 역이 1위로 선정되는지 검증.
- `test_tie_breaking_diff_and_total`: 최대 소요시간이 같을 때 편차(`diff`) 및 합계(`total`) 기준 동점 처리 검증.
- `test_2_participants_scenario`: 참여자가 2명일 때도 정상 동작하는지 검증.
- `test_transit_none_handling`: 이동 시간 계산 실패(`None`) 시의 예외 처리 검증.
