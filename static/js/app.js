// When2Meet & Where2Meet 클라이언트 스크립트

// 전역 상태
let currentRoom = null;
let currentSummary = null;
let mySelectedSlots = new Set();
let isMouseDown = false;
let currentDragAction = 'add'; // 'add' or 'remove'
let activeMode = 'auto'; // 'auto', 'add', 'remove'

const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

// 토스트 메시지 유틸
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// 날짜 포맷 헬퍼 (YYYY-MM-DD -> MM/DD (요일))
function formatDisplayDate(dateStr) {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  const dayName = dayNames[d.getDay()];
  return {
    monthDay: `${parseInt(parts[1])}/${parseInt(parts[2])}`,
    dayName: `(${dayName})`,
    full: `${dateStr} (${dayName})`
  };
}

// 초기 로드
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupToolbar();
  setupShareModal();
  setupWherePreview();
  setupSynchronizedScroll();

  // 이전 참여자 이름 복원
  const savedName = localStorage.getItem(`ww2m_${ROOM_ID}_name`) || '';
  if (savedName) {
    document.getElementById('userNameInput').value = savedName;
  }

  // 초기 데이터 로드
  await fetchRoomData();

  // 자동 복원 시도
  if (savedName) {
    loadUserSchedule(savedName, false);
  }
});

// 기능 전환 토글 스위치 (When to Meet <-> Where to Meet) 설정
function setupTabs() {
  const switchContainer = document.getElementById('modeSwitchContainer');
  const tabWhen = document.getElementById('tabBtnWhen');
  const tabWhere = document.getElementById('tabBtnWhere');
  const contentWhen = document.getElementById('whenTabContent');
  const contentWhere = document.getElementById('whereTabContent');
  const modeBadge = document.getElementById('currentModeBadge');

  if (!tabWhen || !tabWhere || !contentWhen || !contentWhere) return;

  function setMode(mode, showNotification = false) {
    if (mode === 'when') {
      if (switchContainer) switchContainer.classList.remove('where-active');
      tabWhen.classList.add('active');
      tabWhen.setAttribute('aria-pressed', 'true');
      tabWhere.classList.remove('active');
      tabWhere.setAttribute('aria-pressed', 'false');

      // 1. Where to Meet 화면 완전 숨김 (시간표 가림 원천 차단)
      contentWhere.classList.remove('active');
      contentWhere.style.display = 'none';

      // 2. When to Meet 시간표 화면만 온전히 단독 표시
      contentWhen.classList.add('active');
      contentWhen.style.display = 'flex';

      if (modeBadge) {
        modeBadge.textContent = '📅 시간표 조율';
        modeBadge.className = 'nav-badge when-badge';
      }

      if (showNotification) {
        showToast('📅 When to Meet (시간표 조율) 모드입니다.');
      }
    } else {
      if (switchContainer) switchContainer.classList.add('where-active');
      tabWhere.classList.add('active');
      tabWhere.setAttribute('aria-pressed', 'true');
      tabWhen.classList.remove('active');
      tabWhen.setAttribute('aria-pressed', 'false');

      // 1. When to Meet 시간표 화면 완전 숨김
      contentWhen.classList.remove('active');
      contentWhen.style.display = 'none';

      // 2. Where to Meet 화면만 온전히 단독 표시
      contentWhere.classList.add('active');
      contentWhere.style.display = 'flex';

      if (modeBadge) {
        modeBadge.textContent = '📍 장소 찾기';
        modeBadge.className = 'nav-badge where-badge';
      }

      // Where 참여자 출발지 목록 동기화
      syncWhereParticipants();

      if (showNotification) {
        showToast('📍 Where to Meet (장소 찾기) 모드입니다.');
      }
    }
  }

  tabWhen.addEventListener('click', (e) => {
    e.stopPropagation();
    setMode('when', true);
  });

  tabWhere.addEventListener('click', (e) => {
    e.stopPropagation();
    setMode('where', true);
  });

  // 스위치 컨테이너 트랙 클릭 시에도 직관적인 토글 작동
  if (switchContainer) {
    switchContainer.addEventListener('click', (e) => {
      if (e.target === tabWhen || e.target === tabWhere || tabWhen.contains(e.target) || tabWhere.contains(e.target)) {
        return;
      }
      const isWhere = switchContainer.classList.contains('where-active');
      setMode(isWhere ? 'when' : 'where', true);
    });
  }

  // 초기 상태: 웬투밋(When to Meet) 시간표를 가리는 창 없이 한눈에 표시
  setMode('when', false);
}

// 툴바 및 컨트롤 버튼 이벤트
function setupToolbar() {
  const modeAddBtn = document.getElementById('modeAddBtn');
  const modeRemoveBtn = document.getElementById('modeRemoveBtn');

  modeAddBtn.addEventListener('click', () => {
    activeMode = 'add';
    modeAddBtn.classList.add('active');
    modeRemoveBtn.classList.remove('active');
  });

  modeRemoveBtn.addEventListener('click', () => {
    activeMode = 'remove';
    modeRemoveBtn.classList.add('active');
    modeAddBtn.classList.remove('active');
  });

  document.getElementById('btnSelectAll').addEventListener('click', () => {
    if (!currentRoom) return;
    for (const d of currentRoom.dates) {
      for (const t of currentRoom.time_slots) {
        mySelectedSlots.add(`${d}_${t}`);
      }
    }
    renderMySchedule();
  });

  document.getElementById('btnClearAll').addEventListener('click', () => {
    mySelectedSlots.clear();
    renderMySchedule();
  });

  document.getElementById('btnSaveSchedule').addEventListener('click', saveMySchedule);
  document.getElementById('btnLoadUser').addEventListener('click', () => {
    const name = document.getElementById('userNameInput').value.trim();
    if (!name) {
      showToast('불러올 이름을 입력해주세요.');
      return;
    }
    loadUserSchedule(name, true);
  });

  // 전역 마우스업 감지 (드래그 종료)
  window.addEventListener('mouseup', () => {
    isMouseDown = false;
  });
}

// 공유 링크 모달 설정 (다른 사람 컴퓨터 접속용 IP 포함)
function setupShareModal() {
  const modal = document.getElementById('shareModal');
  const btnOpen = document.getElementById('btnShareModal');
  const btnClose = document.getElementById('btnCloseShareModal');

  const lanPort = window.location.port ? `:${window.location.port}` : '';
  const lanUrl = `http://${SERVER_LOCAL_IP || window.location.hostname}${lanPort}/meet/${ROOM_ID}`;
  const localUrl = `http://localhost${lanPort}/meet/${ROOM_ID}`;

  document.getElementById('shareLanUrlInput').value = lanUrl;
  document.getElementById('shareLocalUrlInput').value = localUrl;

  btnOpen.addEventListener('click', (e) => {
    e.stopPropagation();
    modal.style.display = modal.style.display === 'none' ? 'block' : 'none';
  });

  btnClose.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  document.addEventListener('click', (e) => {
    if (!modal.contains(e.target) && e.target !== btnOpen) {
      modal.style.display = 'none';
    }
  });

  document.getElementById('btnCopyLanUrl').addEventListener('click', () => {
    navigator.clipboard.writeText(lanUrl).then(() => {
      showToast('📱 공유용 네트워크 링크가 복사되었습니다!');
      modal.style.display = 'none';
    });
  });

  document.getElementById('btnCopyLocalUrl').addEventListener('click', () => {
    navigator.clipboard.writeText(localUrl).then(() => {
      showToast('💻 로컬 링크가 복사되었습니다!');
      modal.style.display = 'none';
    });
  });
}

// 서버에서 방 데이터 가져오기
async function fetchRoomData() {
  try {
    const res = await fetch(`/api/rooms/${ROOM_ID}`);
    if (!res.ok) throw new Error('방 데이터를 불러오지 못했습니다.');
    const data = await res.json();
    currentRoom = data.room;
    currentSummary = data.summary;

    updateHeaderInfo();
    renderMySchedule();
    renderGroupSchedule();
    renderTopRecommendations();
    renderParticipantChips();
    renderRequiredCheckboxes();
    syncWhereParticipants();
  } catch (err) {
    console.error(err);
    showToast('데이터 로딩 오류 발생');
  }
}

// 상단 헤더 참여자 수 업데이트
function updateHeaderInfo() {
  const pCount = Object.keys(currentRoom.participants || {}).length;
  document.getElementById('headerParticipantCount').textContent = `👥 참여자: ${pCount}명`;
  document.getElementById('groupParticipantBadge').textContent = `${pCount}명 참여 중`;
}

// 내 일정 테이블 렌더링
function renderMySchedule() {
  if (!currentRoom) return;
  const table = document.getElementById('myScheduleTable');
  table.innerHTML = '';

  const { dates, time_slots } = currentRoom;

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const emptyTh = document.createElement('th');
  emptyTh.style.width = '45px';
  emptyTh.textContent = '시간';
  headRow.appendChild(emptyTh);

  dates.forEach(d => {
    const th = document.createElement('th');
    const info = formatDisplayDate(d);
    th.innerHTML = `<span>${info.monthDay}</span><span class="th-day">${info.dayName}</span>`;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  time_slots.forEach(t => {
    const tr = document.createElement('tr');
    
    const timeTd = document.createElement('td');
    timeTd.className = 'time-label';
    timeTd.textContent = t;
    tr.appendChild(timeTd);

    dates.forEach(d => {
      const slotKey = `${d}_${t}`;
      const td = document.createElement('td');
      td.className = 'slot-cell';
      td.dataset.slot = slotKey;

      if (mySelectedSlots.has(slotKey)) {
        td.classList.add('my-selected');
      }

      td.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isMouseDown = true;
        if (activeMode === 'auto') {
          currentDragAction = mySelectedSlots.has(slotKey) ? 'remove' : 'add';
        } else {
          currentDragAction = activeMode;
        }
        applySlotAction(td, slotKey, currentDragAction);
      });

      td.addEventListener('mouseenter', () => {
        if (isMouseDown) {
          applySlotAction(td, slotKey, currentDragAction);
        }
      });

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  setupTouchDrag(table);
}

function applySlotAction(td, slotKey, action) {
  if (action === 'add') {
    mySelectedSlots.add(slotKey);
    td.classList.add('my-selected');
  } else {
    mySelectedSlots.delete(slotKey);
    td.classList.remove('my-selected');
  }
}

function setupTouchDrag(table) {
  table.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
    if (targetEl && targetEl.classList.contains('slot-cell') && targetEl.closest('#myScheduleTable')) {
      const slotKey = targetEl.dataset.slot;
      if (slotKey) {
        applySlotAction(targetEl, slotKey, currentDragAction);
      }
    }
  }, { passive: false });

  table.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
    if (targetEl && targetEl.classList.contains('slot-cell') && targetEl.closest('#myScheduleTable')) {
      const slotKey = targetEl.dataset.slot;
      if (slotKey) {
        if (activeMode === 'auto') {
          currentDragAction = mySelectedSlots.has(slotKey) ? 'remove' : 'add';
        } else {
          currentDragAction = activeMode;
        }
        applySlotAction(targetEl, slotKey, currentDragAction);
      }
    }
  });
}

// 그룹 종합 시간표 렌더링
function renderGroupSchedule() {
  if (!currentRoom || !currentSummary) return;
  const table = document.getElementById('groupScheduleTable');
  table.innerHTML = '';

  const { dates, time_slots } = currentRoom;
  const { slot_stats, total_participants } = currentSummary;

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const emptyTh = document.createElement('th');
  emptyTh.style.width = '45px';
  emptyTh.textContent = '시간';
  headRow.appendChild(emptyTh);

  dates.forEach(d => {
    const th = document.createElement('th');
    const info = formatDisplayDate(d);
    th.innerHTML = `<span>${info.monthDay}</span><span class="th-day">${info.dayName}</span>`;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  time_slots.forEach(t => {
    const tr = document.createElement('tr');

    const timeTd = document.createElement('td');
    timeTd.className = 'time-label';
    timeTd.textContent = t;
    tr.appendChild(timeTd);

    dates.forEach(d => {
      const slotKey = `${d}_${t}`;
      const stat = slot_stats[slotKey] || { count: 0, ratio: 0, available_users: [], unavailable_users: [], all_required_available: true };
      
      const td = document.createElement('td');
      td.className = 'slot-cell';
      td.dataset.slot = slotKey;

      let heatLevel = 0;
      if (total_participants > 0 && stat.count > 0) {
        const ratio = stat.count / total_participants;
        heatLevel = Math.min(6, Math.max(1, Math.ceil(ratio * 6)));
      }
      td.classList.add(`group-heat-${heatLevel}`);

      // 필수 참석자 전원 가능 시 테두리 강조 (필수 참석자가 1명 이상 지정되어 있을 때)
      if (currentSummary.required_participants && currentSummary.required_participants.length > 0) {
        if (stat.all_required_available && stat.count > 0) {
          td.classList.add('required-ok');
        }
      }

      td.addEventListener('mouseenter', () => {
        showHoverDetails(d, t, stat);
      });

      td.addEventListener('mouseleave', () => {
        resetHoverDetails();
      });

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
}

function showHoverDetails(date, time, stat) {
  const titleEl = document.getElementById('hoverTimeTitle');
  const availTextEl = document.getElementById('hoverAvailText');
  const unavailTextEl = document.getElementById('hoverUnavailText');

  const info = formatDisplayDate(date);
  const total = currentSummary.total_participants;

  titleEl.innerHTML = `<strong>${info.monthDay}${info.dayName} ${time}</strong> <span style="color: #10b981; font-weight: 700;">(${stat.count}/${total}명)</span>`;

  const requiredSet = new Set(currentSummary.required_participants || []);
  
  if (stat.available_users && stat.available_users.length > 0) {
    const formattedAvail = stat.available_users.map(u => requiredSet.has(u) ? `<strong>${u}⭐</strong>` : u);
    availTextEl.innerHTML = formattedAvail.join(', ');
  } else {
    availTextEl.textContent = '없음';
  }

  if (stat.unavailable_users && stat.unavailable_users.length > 0) {
    const formattedUnavail = stat.unavailable_users.map(u => requiredSet.has(u) ? `<strong>${u}⭐</strong>` : u);
    unavailTextEl.innerHTML = formattedUnavail.join(', ');
  } else {
    unavailTextEl.textContent = '전원 가능 🎉';
  }
}

function resetHoverDetails() {
  document.getElementById('hoverTimeTitle').textContent = '시간표 위에 마우스를 올려보세요';
  document.getElementById('hoverAvailText').textContent = '-';
  document.getElementById('hoverUnavailText').textContent = '-';
}

// 필수 참석자(VIP) 선택 체크박스 목록 렌더링 및 변경 이벤트 ★
function renderRequiredCheckboxes() {
  const container = document.getElementById('requiredParticipantsList');
  const countBadge = document.getElementById('requiredCountBadge');
  container.innerHTML = '';

  const participants = currentRoom ? currentRoom.participants : {};
  const names = Object.keys(participants);

  if (names.length === 0) {
    container.innerHTML = '<span style="color: #92400e; font-size: 0.75rem; opacity: 0.8;">참여자 등록 대기 중</span>';
    if (countBadge) countBadge.style.display = 'none';
    return;
  }

  const currentRequired = new Set(currentSummary.required_participants || []);
  if (countBadge) {
    countBadge.style.display = 'inline-block';
    countBadge.textContent = `${currentRequired.size}명 지정`;
  }

  names.forEach(name => {
    const isChecked = currentRequired.has(name);
    const item = document.createElement('label');
    item.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 2px 7px;
      background: ${isChecked ? '#fef3c7' : '#ffffff'};
      border: 1px solid ${isChecked ? '#f59e0b' : '#cbd5e1'};
      border-radius: 12px;
      cursor: pointer;
      font-size: 0.75rem;
      font-weight: ${isChecked ? '700' : '500'};
      color: ${isChecked ? '#92400e' : '#374151'};
      user-select: none;
      white-space: nowrap;
      transition: all 0.15s ease;
    `;

    item.innerHTML = `
      <input type="checkbox" value="${name}" ${isChecked ? 'checked' : ''} style="accent-color: #f59e0b; cursor: pointer; transform: scale(0.85);">
      <span>${name}</span>
      ${isChecked ? '<span style="color: #d97706; font-size: 0.7rem;">⭐</span>' : ''}
    `;

    const chk = item.querySelector('input');
    chk.addEventListener('change', async () => {
      const allChecked = Array.from(container.querySelectorAll('input:checked')).map(el => el.value);
      await updateRequiredSelection(allChecked);
    });

    container.appendChild(item);
  });
}

// 서버에 필수 참석자 명단 업데이트 요청
async function updateRequiredSelection(requiredNames) {
  try {
    const res = await fetch(`/api/rooms/${ROOM_ID}/required-participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ required_names: requiredNames })
    });
    const data = await res.json();
    if (data.success) {
      currentRoom = data.room;
      currentSummary = data.summary;

      renderGroupSchedule();
      renderTopRecommendations();
      renderParticipantChips();
      renderRequiredCheckboxes();

      if (requiredNames.length > 0) {
        showToast(`⭐ 필수 참석자(${requiredNames.join(', ')})가 반영되어 시간표가 갱신되었습니다.`);
      } else {
        showToast('필수 참석자 지정이 해제되었습니다.');
      }
    }
  } catch (err) {
    console.error(err);
    showToast('필수 참석자 설정 변경 중 오류가 발생했습니다.');
  }
}

// TOP 3 추천 시간대 렌더링 (컴팩트 슬림 바)
function renderTopRecommendations() {
  const container = document.getElementById('recCardsContainer');
  const section = document.getElementById('topRecSection');
  container.innerHTML = '';

  const recs = currentSummary ? currentSummary.top_recommendations : [];
  if (!recs || recs.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'flex';

  recs.forEach((rec, idx) => {
    const card = document.createElement('div');
    card.className = 'rec-card-compact';
    const rank = idx + 1;
    const info = formatDisplayDate(rec.date);

    card.innerHTML = `
      <span class="rec-rank-badge rank-${rank}">TOP ${rank}</span>
      <span class="rec-time-compact">${info.monthDay}${info.dayName} <strong>${rec.start_time}~${rec.end_time}</strong></span>
      <span class="rec-members-tag-compact">👥 ${rec.available_count}/${rec.total_participants}명</span>
      ${rec.all_required_available && currentSummary.required_participants.length > 0 ? '<span class="rec-vip-tag-compact">⭐VIP만족</span>' : ''}
    `;

    card.addEventListener('mouseenter', () => {
      highlightTimeRange(rec.date, rec.start_time, rec.end_time);
    });
    card.addEventListener('mouseleave', () => {
      clearHighlights();
    });

    container.appendChild(card);
  });
}

// 시간표 동기화 스크롤 설정 (좌/우 테이블 스크롤 연동)
function setupSynchronizedScroll() {
  const left = document.getElementById('myScheduleWrapper');
  const right = document.getElementById('groupScheduleTableContainer');
  if (!left || !right) return;

  let isSyncingLeft = false;
  let isSyncingRight = false;

  left.addEventListener('scroll', () => {
    if (!isSyncingLeft) {
      isSyncingRight = true;
      right.scrollTop = left.scrollTop;
      right.scrollLeft = left.scrollLeft;
    }
    isSyncingLeft = false;
  });

  right.addEventListener('scroll', () => {
    if (!isSyncingRight) {
      isSyncingLeft = true;
      left.scrollTop = right.scrollTop;
      left.scrollLeft = right.scrollLeft;
    }
    isSyncingRight = false;
  });
}

function highlightTimeRange(date, startTime, endTime) {
  const cells = document.querySelectorAll('#groupScheduleTable .slot-cell');
  cells.forEach(td => {
    const slotKey = td.dataset.slot;
    if (!slotKey) return;
    const [d, t] = slotKey.split('_');
    if (d === date && t >= startTime && t < endTime) {
      td.classList.add('highlight-member');
    } else {
      td.classList.add('dim-member');
    }
  });
}

function clearHighlights() {
  const cells = document.querySelectorAll('#groupScheduleTable .slot-cell');
  cells.forEach(td => {
    td.classList.remove('highlight-member', 'dim-member');
  });
}

// 참여자 명단 칩 렌더링 및 호버 하이라이트
function renderParticipantChips() {
  const container = document.getElementById('participantChipsList');
  container.innerHTML = '';

  const participants = currentRoom ? currentRoom.participants : {};
  const names = Object.keys(participants);

  if (names.length === 0) {
    container.innerHTML = '<span style="color: var(--text-muted); font-size: 0.82rem;">아직 등록된 참여자가 없습니다.</span>';
    return;
  }

  names.forEach(name => {
    const p = participants[name];
    const chip = document.createElement('div');
    chip.className = 'p-chip';
    chip.innerHTML = `
      <span>${name}</span>
      ${p.is_required ? '<span class="required-badge">⭐ 필수</span>' : ''}
    `;

    chip.addEventListener('click', () => {
      document.getElementById('userNameInput').value = name;
      loadUserSchedule(name, true);
    });

    chip.addEventListener('mouseenter', () => {
      const availSet = new Set(p.available_slots || []);
      const cells = document.querySelectorAll('#groupScheduleTable .slot-cell');
      cells.forEach(td => {
        const slotKey = td.dataset.slot;
        if (availSet.has(slotKey)) {
          td.classList.add('highlight-member');
        } else {
          td.classList.add('dim-member');
        }
      });
    });

    chip.addEventListener('mouseleave', () => {
      clearHighlights();
    });

    container.appendChild(chip);
  });
}

function loadUserSchedule(name, notify = true) {
  if (!currentRoom || !currentRoom.participants) return;
  const p = currentRoom.participants[name];
  if (!p) {
    if (notify) showToast(`'${name}' 님의 등록된 일정이 없습니다. 새로 입력하세요.`);
    return;
  }

  mySelectedSlots = new Set(p.available_slots || []);
  renderMySchedule();
  if (notify) showToast(`'${name}' 님의 일정을 불러왔습니다.`);
}

// 내 일정 저장하기
async function saveMySchedule() {
  const nameInput = document.getElementById('userNameInput');
  const name = nameInput.value.trim();

  if (!name) {
    showToast('이름(닉네임)을 입력해주세요.');
    nameInput.focus();
    return;
  }

  const payload = {
    name: name,
    available_slots: Array.from(mySelectedSlots),
    origin: ''
  };

  try {
    const res = await fetch(`/api/rooms/${ROOM_ID}/availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message || '일정이 성공적으로 저장되었습니다!');
      localStorage.setItem(`ww2m_${ROOM_ID}_name`, name);

      currentRoom = data.room;
      currentSummary = data.summary;

      updateHeaderInfo();
      renderGroupSchedule();
      renderTopRecommendations();
      renderParticipantChips();
      renderRequiredCheckboxes();
      syncWhereParticipants();
    } else {
      showToast('저장 실패: ' + (data.detail || ''));
    }
  } catch (err) {
    console.error(err);
    showToast('서버 저장 중 오류가 발생했습니다.');
  }
}

// WHERE TO MEET UI 미리보기 설정
function setupWherePreview() {
  document.querySelectorAll('.purpose-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.purpose-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      showToast(`'${card.querySelector('.purpose-name').textContent}' 목적이 선택되었습니다.`);
    });
  });

  document.getElementById('btnRunWherePreview').addEventListener('click', () => {
    showToast('⚡ 대중교통 최적 중간 장소 계산 시뮬레이션 완료! (현재 UI 프리뷰 단계입니다)');
  });
}

function syncWhereParticipants() {
  const container = document.getElementById('whereOriginInputsList');
  if (!container) return;
  container.innerHTML = '';

  const participants = currentRoom ? currentRoom.participants : {};
  const names = Object.keys(participants);

  if (names.length === 0) {
    const defaults = [
      { name: '김준명', origin: '강남역' },
      { name: '유한영', origin: '혜화역' },
      { name: '이랑', origin: '수원역' }
    ];
    defaults.forEach(d => {
      createOriginInputRow(container, d.name, d.origin, true);
    });
  } else {
    names.forEach(name => {
      const p = participants[name];
      createOriginInputRow(container, name, p.origin || '', false);
    });
  }
}

function createOriginInputRow(container, name, originVal, isMock) {
  const row = document.createElement('div');
  row.className = 'origin-input-row';
  row.innerHTML = `
    <span class="origin-user-name" title="${name}">${name}</span>
    <input 
      type="text" 
      class="form-control" 
      style="padding: 6px 10px; font-size: 0.85rem;" 
      placeholder="출발역 또는 주소 (예: 강남역)" 
      value="${originVal}"
    >
  `;

  const input = row.querySelector('input');
  input.addEventListener('change', async () => {
    if (!isMock) {
      try {
        await fetch(`/api/rooms/${ROOM_ID}/origin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, origin: input.value.trim() })
        });
        showToast(`${name}님의 출발지가 저장되었습니다.`);
      } catch (e) {
        console.error(e);
      }
    } else {
      showToast(`${name}님의 출발지가 임시 설정되었습니다.`);
    }
  });

  container.appendChild(row);
}
