from fastapi.testclient import TestClient
from main import app
import storage

client = TestClient(app)

def test_custom_url_and_required_flow():
    # 0. 멱등성을 위해 기존 테스트 룸 초기화
    rooms = storage._load_all_rooms()
    if 'team-study-2026' in rooms:
        del rooms['team-study-2026']
        storage._save_all_rooms(rooms)

    # 1. 네트워크 정보 확인
    res = client.get('/api/network-info')
    assert res.status_code == 200
    net_data = res.json()
    assert 'local_ip' in net_data
    print('Detected local IP:', net_data['local_ip'])

    # 2. 직관적인 커스텀 ID로 방 생성 (/meet/team-study-2026)
    create_payload = {
        'title': '직관적 URL 테스트 회의',
        'dates': ['2026-11-20', '2026-11-21'],
        'time_start': '10:00',
        'time_end': '18:00',
        'custom_id': 'team-study-2026'
    }
    res = client.post('/api/rooms', json=create_payload)
    assert res.status_code == 200
    room = res.json()['room']
    assert room['id'] == 'team-study-2026', f"Expected room_id 'team-study-2026', got {room['id']}"
    print('Created custom room:', room['id'])

    # 3. 직관적인 /meet/{room_id} 접속 확인
    res = client.get('/meet/team-study-2026')
    assert res.status_code == 200
    assert '직관적 URL 테스트 회의' in res.text

    # 4. 이전 /room/{room_id} 리다이렉트 확인
    res = client.get('/room/team-study-2026', follow_redirects=False)
    assert res.status_code in (301, 302, 307)
    assert '/meet/team-study-2026' in res.headers['location']
    print('Redirect from /room to /meet verified!')

    # 5. 참여자 3명이 시간표를 먼저 자유롭게 등록
    # 김준명: 14:00 ~ 15:30 가능
    client.post('/api/rooms/team-study-2026/availability', json={
        'name': '김준명',
        'available_slots': ['2026-11-20_14:00', '2026-11-20_14:30', '2026-11-20_15:00', '2026-11-20_15:30']
    })
    # 유한영: 14:30 ~ 16:30 가능
    client.post('/api/rooms/team-study-2026/availability', json={
        'name': '유한영',
        'available_slots': ['2026-11-20_14:30', '2026-11-20_15:00', '2026-11-20_15:30', '2026-11-20_16:00']
    })
    # 이랑: 15:00 ~ 17:00 가능
    client.post('/api/rooms/team-study-2026/availability', json={
        'name': '이랑',
        'available_slots': ['2026-11-20_15:00', '2026-11-20_15:30', '2026-11-20_16:00', '2026-11-20_16:30']
    })

    # 참여자 목록 조회
    res = client.get('/api/rooms/team-study-2026')
    data = res.json()
    assert data['summary']['total_participants'] == 3
    assert len(data['summary']['required_participants']) == 0
    print('3 participants registered schedules without initial required flags.')

    # 6. 다른 사람들도 다 등록한 후, 참여자 리스트에서 '김준명'과 '이랑'을 필수 참석자로 지정!
    res = client.post('/api/rooms/team-study-2026/required-participants', json={
        'required_names': ['김준명', '이랑']
    })
    assert res.status_code == 200
    updated_data = res.json()
    req_list = updated_data['summary']['required_participants']
    assert set(req_list) == {'김준명', '이랑'}
    print('Required participants dynamically updated to:', req_list)

    # 7. 필수 참석자 2명이 모두 가능한 시간대 검증 (15:00 ~ 16:00)
    slot_1500 = updated_data['summary']['slot_stats']['2026-11-20_15:00']
    assert slot_1500['all_required_available'] is True
    assert slot_1500['count'] == 3

    # 김준명만 가능하고 이랑은 불가능한 14:00 슬롯은 all_required_available이 False여야 함
    slot_1400 = updated_data['summary']['slot_stats']['2026-11-20_14:00']
    assert slot_1400['all_required_available'] is False

    # 최적 추천 1순위는 필수 참석자 2명이 모두 포함된 시간대인지 확인
    top1 = updated_data['summary']['top_recommendations'][0]
    print('Top 1 after required setting:', top1['date'], top1['start_time'], '~', top1['end_time'], 
          f"(필수만족: {top1['all_required_available']}, {top1['available_count']}/{top1['total_participants']}명)")
    assert top1['all_required_available'] is True
    assert '김준명' in top1['available_users'] and '이랑' in top1['available_users']

    print('\n======================================================')
    print('🎉 직관적인 URL + 동적 필수 참석자 관리 전체 테스트 통과!')
    print('======================================================')

if __name__ == '__main__':
    test_custom_url_and_required_flow()
