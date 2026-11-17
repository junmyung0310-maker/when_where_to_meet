// When2Meet & Where2Meet 통합 클라이언트 스크립트

// 전역 상태 (When to Meet)
let currentRoom = null;
let currentSummary = null;
let mySelectedSlots = new Set();
let isMouseDown = false;
let currentDragAction = 'add'; // 'add' or 'remove'
let activeMode = 'auto'; // 'auto', 'add', 'remove'

// 전역 상태 (Where to Meet)
let kakaoMap = null;
let mapMarkers = [];
let mapCustomOverlays = [];
let currentWhereResult = null;
let selectedCandidateStation = null;
let currentPurpose = 'study';

const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

// HTML 안전 이스케이프 유틸리티
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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
  setupWhereTab();
  setupSynchronizedScroll();

  // 이전 참여자 이름 복원
  const savedName = localStorage.getItem(`ww2m_${ROOM_ID}_name`) || '';
  if (savedName) {
    document.getElementById('userNameInput').value = savedName;
  }

  // 초기 데이터 로드 (When to Meet)
  await fetchRoomData();

  // 자동 복원 시도
  if (savedName) {
    loadUserSchedule(savedName, false);
  }

  // 카카오 지도 SDK 초기화
  initKakaoMap();

  // 이전 Where to Meet 계산 결과가 있다면 복원
  await loadSavedWhereResult();
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

      // 탭 전환 시 지도가 깨지지 않도록 relayout
      if (kakaoMap) {
        setTimeout(() => {
          kakaoMap.relayout();
          if (currentWhereResult && currentWhereResult.candidates) {
            fitMapBounds(currentWhereResult.origins, currentWhereResult.candidates);
          }
        }, 100);
      }

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

  window.addEventListener('mouseup', () => {
    isMouseDown = false;
  });
}

// 공유 링크 모달 설정
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
    const formattedAvail = stat.available_users.map(u => requiredSet.has(u) ? `<strong>${escapeHtml(u)}⭐</strong>` : escapeHtml(u));
    availTextEl.innerHTML = formattedAvail.join(', ');
  } else {
    availTextEl.textContent = '없음';
  }

  if (stat.unavailable_users && stat.unavailable_users.length > 0) {
    const formattedUnavail = stat.unavailable_users.map(u => requiredSet.has(u) ? `<strong>${escapeHtml(u)}⭐</strong>` : escapeHtml(u));
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

// 필수 참석자(VIP) 선택 체크박스 목록 렌더링
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
      <input type="checkbox" value="${escapeHtml(name)}" ${isChecked ? 'checked' : ''} style="accent-color: #f59e0b; cursor: pointer; transform: scale(0.85);">
      <span>${escapeHtml(name)}</span>
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

// TOP 3 추천 시간대 렌더링
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

// 시간표 동기화 스크롤 설정
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

// 참여자 명단 칩 렌더링
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
      <span>${escapeHtml(name)}</span>
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


// =====================================================================
// WHERE TO MEET (공평한 중간 장소 추천) 클라이언트 로직
// =====================================================================

function initKakaoMap() {
  const mapContainer = document.getElementById('kakaoMap');
  const fallbackNotice = document.getElementById('mapFallbackNotice');

  if (!window.kakao || !window.kakao.maps) {
    if (fallbackNotice) {
      fallbackNotice.style.display = 'flex';
      fallbackNotice.innerHTML = `
        <div style="text-align: center; padding: 20px;">
          <p style="font-size: 1.1rem; font-weight: 700; margin-bottom: 6px;">🗺️ 카카오 지도 SDK 대기 중</p>
          <p style="font-size: 0.8rem; color: #64748b;">
            ${KAKAO_JS_KEY ? '카카오 지도 라이브러리를 로드하고 있습니다.' : '카카오 JavaScript 키가 .env에 설정되지 않았습니다.'}
          </p>
        </div>
      `;
    }
    return;
  }

  window.kakao.maps.load(() => {
    try {
      const options = {
        center: new kakao.maps.LatLng(37.5665, 126.9780), // 서울 시청 중심
        level: 8
      };
      kakaoMap = new kakao.maps.Map(mapContainer, options);
      if (fallbackNotice) fallbackNotice.style.display = 'none';

      // 줌 컨트롤 추가
      const zoomControl = new kakao.maps.ZoomControl();
      kakaoMap.addControl(zoomControl, kakao.maps.ControlPosition.RIGHT);

      if (currentWhereResult && currentWhereResult.candidates) {
        fitMapBounds(currentWhereResult.origins, currentWhereResult.candidates);
      }
    } catch (e) {
      console.error('Kakao Map init failed:', e);
      if (fallbackNotice) fallbackNotice.style.display = 'flex';
    }
  });
}

function setupWhereTab() {
  // 모임 목적 카드 클릭
  document.querySelectorAll('.purpose-card').forEach(card => {
    card.addEventListener('click', async () => {
      document.querySelectorAll('.purpose-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      currentPurpose = card.dataset.purpose;
      const purposeName = card.querySelector('.purpose-name').textContent;
      showToast(`'${purposeName}' 모임 목적이 선택되었습니다.`);

      // 이미 선택된 후보 역이 있다면 해당 역의 장소 목록을 실시간으로 다시 조회
      if (selectedCandidateStation) {
        await fetchPlacesForStation(selectedCandidateStation, currentPurpose);
      }
    });
  });

  // 최적 중간 지점 계산 버튼
  const btnCalc = document.getElementById('btnRunWhereCalc');
  if (btnCalc) {
    btnCalc.addEventListener('click', runWhereCalculation);
  }

  // 팀원 직접 추가 버튼 및 엔터 키 이벤트
  const btnAddUser = document.getElementById('btnAddWhereParticipant');
  const inputNewUser = document.getElementById('inputNewParticipantName');
  if (btnAddUser && inputNewUser) {
    const handleAddUser = () => {
      const newName = inputNewUser.value.trim();
      if (!newName) {
        showToast('추가할 팀원 이름을 입력해주세요.');
        inputNewUser.focus();
        return;
      }
      if (currentRoom) {
        if (!currentRoom.participants) currentRoom.participants = {};
        if (!currentRoom.participants[newName]) {
          currentRoom.participants[newName] = { name: newName, available_slots: [], origin: '' };
        }
      }
      inputNewUser.value = '';
      syncWhereParticipants();
      showToast(`'${newName}' 팀원이 추가되었습니다. 출발지를 입력해주세요.`);
    };

    btnAddUser.addEventListener('click', handleAddUser);
    inputNewUser.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddUser();
      }
    });
  }
}

// Where to Meet 계산 실행 API 호출
async function runWhereCalculation() {
  const btnCalc = document.getElementById('btnRunWhereCalc');
  const statusText = document.getElementById('whereCalcStatusText');
  
  btnCalc.disabled = true;
  btnCalc.innerHTML = '⏳ 계산 중...';
  if (statusText) statusText.textContent = '대중교통 경로 및 공평성 계산 중...';

  try {
    const res = await fetch(`/api/rooms/${ROOM_ID}/where`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose: currentPurpose })
    });

    const data = await res.json();
    currentWhereResult = data;

    renderWhereWarnings(data.warnings || []);

    if (data.success && data.candidates && data.candidates.length > 0) {
      selectedCandidateStation = data.candidates[0]; // 1위 역 기본 선택
      renderWhereCandidates(data.candidates);
      renderWhereTransitChart(selectedCandidateStation);
      renderWherePlaces(data.places || []);
      renderMapMarkers(data.origins || [], data.candidates || [], selectedCandidateStation);
      showToast(`🎯 최적 중간 장소 1위 '${selectedCandidateStation.name}' 계산 완료!`);
      if (statusText) statusText.textContent = `1위: ${selectedCandidateStation.name}`;
    } else {
      const warnMsg = (data.warnings && data.warnings.length > 0) 
        ? data.warnings[0] 
        : '중간 장소를 계산할 수 없습니다. 출발지를 확인해주세요.';
      showToast(warnMsg);
      if (statusText) statusText.textContent = '계산 실패';
    }
  } catch (err) {
    console.error(err);
    showToast('중간 지점 계산 중 오류가 발생했습니다.');
    if (statusText) statusText.textContent = '오류 발생';
  } finally {
    btnCalc.disabled = false;
    btnCalc.innerHTML = '⚡ 최적 중간 지점 계산하기';
  }
}

// 저장된 결과 복원
async function loadSavedWhereResult() {
  try {
    const res = await fetch(`/api/rooms/${ROOM_ID}/where`);
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.success && data.candidates && data.candidates.length > 0) {
      currentWhereResult = data;
      selectedCandidateStation = data.candidates[0];
      if (data.purpose) {
        currentPurpose = data.purpose;
        document.querySelectorAll('.purpose-card').forEach(c => {
          c.classList.toggle('selected', c.dataset.purpose === currentPurpose);
        });
      }
      renderWhereWarnings(data.warnings || []);
      renderWhereCandidates(data.candidates);
      renderWhereTransitChart(selectedCandidateStation);
      renderWherePlaces(data.places || []);
      renderMapMarkers(data.origins || [], data.candidates || [], selectedCandidateStation);
      
      const statusText = document.getElementById('whereCalcStatusText');
      if (statusText) statusText.textContent = `1위: ${selectedCandidateStation.name}`;
    }
  } catch (e) {
    console.warn('Saved where result load skipped:', e);
  }
}

// 경고/안내 배너 렌더링
function renderWhereWarnings(warnings) {
  const box = document.getElementById('whereWarningsContainer');
  if (!box) return;

  if (!warnings || warnings.length === 0) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }

  box.style.display = 'block';
  box.innerHTML = `
    <div style="font-weight: 700; margin-bottom: 4px;">⚠️ 안내 사항</div>
    <ul style="margin: 0; padding-left: 18px;">
      ${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
    </ul>
  `;
}

// 추천 역 순위 카드 목록 렌더링
function renderWhereCandidates(candidates) {
  const container = document.getElementById('whereCandidatesList');
  if (!container) return;
  container.innerHTML = '';

  if (!candidates || candidates.length === 0) {
    container.innerHTML = `
      <div class="where-empty-notice">
        추천할 수 있는 역을 찾지 못했습니다.
      </div>
    `;
    return;
  }

  candidates.forEach(cand => {
    const isSelected = selectedCandidateStation && selectedCandidateStation.name === cand.name;
    const card = document.createElement('div');
    card.className = `where-candidate-card ${isSelected ? 'active' : ''}`;
    
    // 랭크 배지 색상
    let rankBadgeClass = 'rank-badge-other';
    if (cand.rank === 1) rankBadgeClass = 'rank-badge-1';
    else if (cand.rank === 2) rankBadgeClass = 'rank-badge-2';
    else if (cand.rank === 3) rankBadgeClass = 'rank-badge-3';

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="cand-rank-badge ${rankBadgeClass}">${cand.rank}위</span>
          <span class="cand-station-name">${escapeHtml(cand.name)}</span>
        </div>
        <span class="cand-max-time">최대 <strong>${cand.max_time}분</strong></span>
      </div>
      <div class="cand-metrics-row">
        <span>최대 편차: <strong>${cand.diff}분</strong></span>
        <span>·</span>
        <span>소요시간 합계: <strong>${cand.total}분</strong></span>
      </div>
    `;

    card.addEventListener('click', async () => {
      document.querySelectorAll('.where-candidate-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selectedCandidateStation = cand;

      renderWhereTransitChart(cand);
      highlightCandidateMarker(cand);
      await fetchPlacesForStation(cand, currentPurpose);
    });

    container.appendChild(card);
  });
}

// 참여자별 이동 시간 막대 차트 렌더링
function renderWhereTransitChart(station) {
  const chartBox = document.getElementById('whereTransitChart');
  const titleName = document.getElementById('whereSelectedStationName');
  const diffBadge = document.getElementById('whereDiffBadge');

  if (titleName) titleName.textContent = station ? station.name : '-';
  if (diffBadge) {
    if (station) {
      diffBadge.style.display = 'inline-block';
      diffBadge.textContent = `최대 편차 ${station.diff}분`;
    } else {
      diffBadge.style.display = 'none';
    }
  }

  if (!chartBox || !station || !station.times) {
    if (chartBox) {
      chartBox.innerHTML = '<div style="font-size: 0.78rem; color: var(--text-muted); text-align: center; padding: 10px;">이동 시간 정보가 없습니다.</div>';
    }
    return;
  }

  chartBox.innerHTML = '';
  const entries = Object.entries(station.times);
  const maxTime = station.max_time || 60;

  entries.forEach(([name, minutes]) => {
    const isBottleneck = minutes === station.max_time && entries.length > 1;
    const ratio = Math.max(8, Math.min(100, Math.round((minutes / maxTime) * 100)));

    const row = document.createElement('div');
    row.className = 'transit-bar-row';
    row.innerHTML = `
      <span class="transit-user-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
      <div class="transit-bar-track">
        <div class="transit-bar-fill ${isBottleneck ? 'bottleneck' : ''}" style="width: ${ratio}%;">
          <span class="transit-bar-label">${minutes}분</span>
        </div>
      </div>
      ${isBottleneck ? '<span class="transit-bottleneck-tag">최대소요</span>' : '<span style="width: 48px;"></span>'}
    `;
    chartBox.appendChild(row);
  });
}

// 특정 역 주변 장소 목록 API 호출 및 렌더링
async function fetchPlacesForStation(station, purpose) {
  const container = document.getElementById('wherePlaceList');
  const titleEl = document.getElementById('wherePlaceStationTitle');
  if (titleEl) titleEl.textContent = station.name;

  if (container) {
    container.innerHTML = '<div style="font-size: 0.78rem; color: var(--text-muted); text-align: center; padding: 10px;">장소를 검색하고 있습니다...</div>';
  }

  try {
    const url = `/api/rooms/${ROOM_ID}/where/places?station=${encodeURIComponent(station.name)}&lat=${station.lat}&lng=${station.lng}&purpose=${purpose}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.success) {
      renderWherePlaces(data.places || []);
    }
  } catch (err) {
    console.error(err);
    if (container) {
      container.innerHTML = '<div style="font-size: 0.78rem; color: #ef4444; text-align: center; padding: 10px;">장소 검색 중 오류가 발생했습니다.</div>';
    }
  }
}

// 목적별 추천 장소 카드 목록 렌더링
function renderWherePlaces(places) {
  const container = document.getElementById('wherePlaceList');
  if (!container) return;
  container.innerHTML = '';

  if (!places || places.length === 0) {
    container.innerHTML = `
      <div style="font-size: 0.78rem; color: var(--text-muted); text-align: center; padding: 12px;">
        추천된 역 인근에서 조건에 맞는 장소를 찾지 못했습니다.
      </div>
    `;
    return;
  }

  places.forEach((p, idx) => {
    const card = document.createElement('div');
    card.className = 'place-card-item';
    card.innerHTML = `
      <div class="place-card-header">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="place-rank-num">${idx + 1}</span>
          <strong class="place-name">${escapeHtml(p.name)}</strong>
        </div>
        <span class="place-distance">${p.distance}m</span>
      </div>
      <div class="place-address">${escapeHtml(p.address)}</div>
      <div class="place-footer">
        <span class="place-category">${escapeHtml(p.category)}</span>
        ${p.url ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer" class="place-link-btn">카카오맵 바로가기 ↗</a>` : ''}
      </div>
    `;
    container.appendChild(card);
  });
}

// 카카오 지도 마커 및 인포 오버레이 렌더링
function renderMapMarkers(origins, candidates, selectedStation) {
  if (!kakaoMap) return;

  // 기존 마커 및 오버레이 제거
  clearMapMarkers();

  const bounds = new kakao.maps.LatLngBounds();
  let hasPoints = false;

  // 1. 참여자 출발지 마커들 (파란색/기본 핀 + 커스텀 오버레이 이름표)
  origins.forEach(orig => {
    if (orig.found && orig.lat && orig.lng) {
      const pos = new kakao.maps.LatLng(orig.lat, orig.lng);
      bounds.extend(pos);
      hasPoints = true;

      // 마커 생성
      const marker = new kakao.maps.Marker({
        position: pos,
        map: kakaoMap
      });
      mapMarkers.push(marker);

      // 이름 오버레이
      const overlayContent = document.createElement('div');
      overlayContent.className = 'map-user-overlay';
      overlayContent.innerHTML = `<span>👤 ${escapeHtml(orig.name)}</span>`;

      const overlay = new kakao.maps.CustomOverlay({
        position: pos,
        content: overlayContent,
        yAnchor: 2.2
      });
      overlay.setMap(kakaoMap);
      mapCustomOverlays.push(overlay);
    }
  });

  // 2. 후보 지하철역 마커들 (1위 강조 핀, 2/3위 보조 핀)
  candidates.forEach(cand => {
    const pos = new kakao.maps.LatLng(cand.lat, cand.lng);
    bounds.extend(pos);
    hasPoints = true;

    const isTop1 = cand.rank === 1;
    const isSelected = selectedStation && selectedStation.name === cand.name;

    // 커스텀 역 핀 오버레이
    const stOverlayEl = document.createElement('div');
    stOverlayEl.className = `map-station-overlay ${isTop1 ? 'top1' : ''} ${isSelected ? 'selected' : ''}`;
    stOverlayEl.innerHTML = `
      <span class="station-rank">${cand.rank}위</span>
      <span class="station-label">${escapeHtml(cand.name)}</span>
    `;

    stOverlayEl.addEventListener('click', () => {
      // 역 클릭 시 해당 역 선택
      const card = document.querySelector(`.where-candidate-card[data-name="${cand.name}"]`);
      if (card) card.click();
      else {
        selectedCandidateStation = cand;
        renderWhereTransitChart(cand);
        fetchPlacesForStation(cand, currentPurpose);
      }
    });

    const overlay = new kakao.maps.CustomOverlay({
      position: pos,
      content: stOverlayEl,
      yAnchor: 1.2
    });
    overlay.setMap(kakaoMap);
    mapCustomOverlays.push(overlay);
  });

  // 모든 핀이 화면에 보이도록 Bounds 자동 조정
  if (hasPoints) {
    kakaoMap.setBounds(bounds);
  }
}

function clearMapMarkers() {
  mapMarkers.forEach(m => m.setMap(null));
  mapMarkers = [];
  mapCustomOverlays.forEach(o => o.setMap(null));
  mapCustomOverlays = [];
}

function highlightCandidateMarker(cand) {
  if (!kakaoMap || !cand) return;
  kakaoMap.panTo(new kakao.maps.LatLng(cand.lat, cand.lng));
  
  // 지도 상의 오버레이 선택 클래스 갱신
  document.querySelectorAll('.map-station-overlay').forEach(el => {
    if (el.textContent.includes(cand.name)) {
      el.classList.add('selected');
    } else {
      el.classList.remove('selected');
    }
  });
}

function fitMapBounds(origins, candidates) {
  if (!kakaoMap) return;
  const bounds = new kakao.maps.LatLngBounds();
  let hasPt = false;

  (origins || []).forEach(o => {
    if (o.found && o.lat && o.lng) {
      bounds.extend(new kakao.maps.LatLng(o.lat, o.lng));
      hasPt = true;
    }
  });

  (candidates || []).forEach(c => {
    if (c.lat && c.lng) {
      bounds.extend(new kakao.maps.LatLng(c.lat, c.lng));
      hasPt = true;
    }
  });

  if (hasPt) {
    kakaoMap.setBounds(bounds);
  }
}

// Where 탭 출발지 목록 동기화
function syncWhereParticipants() {
  const container = document.getElementById('whereOriginInputsList');
  if (!container) return;
  container.innerHTML = '';

  const participants = currentRoom ? (currentRoom.participants || {}) : {};
  const participantNames = Object.keys(participants);

  // When to Meet 이름 입력창에 현재 적혀있는 내 이름 (아직 저장을 누르지 않은 경우에도 편의를 위해 포함)
  const inputEl = document.getElementById('userNameInput');
  const typedName = inputEl ? inputEl.value.trim() : '';

  // 표시할 팀원 명단 (When to meet에서 설정한 팀원들 + 현재 입력된 이름)
  const displayNames = [...participantNames];
  if (typedName && !displayNames.includes(typedName)) {
    displayNames.push(typedName);
  }

  if (displayNames.length === 0) {
    const emptyNotice = document.createElement('div');
    emptyNotice.className = 'where-empty-notice';
    emptyNotice.style.padding = '14px 10px';
    emptyNotice.style.textAlign = 'center';
    emptyNotice.style.fontSize = '0.8rem';
    emptyNotice.style.color = 'var(--text-muted)';
    emptyNotice.style.background = '#f8fafc';
    emptyNotice.style.borderRadius = '8px';
    emptyNotice.style.border = '1px dashed #cbd5e1';
    emptyNotice.innerHTML = `
      <span>📅 아직 등록된 팀원이 없습니다.</span><br>
      <span style="font-size: 0.74rem; color: #64748b; margin-top: 4px; display: inline-block;">
        <strong>When to Meet(일정 조율)</strong>에서 시간표를 저장하거나,<br>아래에서 팀원을 직접 추가해주세요.
      </span>
    `;
    container.appendChild(emptyNotice);
  } else {
    displayNames.forEach(name => {
      const p = participants[name] || {};
      createOriginInputRow(container, name, p.origin || '');
    });
  }
}

function createOriginInputRow(container, name, originVal) {
  const row = document.createElement('div');
  row.className = 'origin-input-row';
  row.innerHTML = `
    <span class="origin-user-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
    <input 
      type="text" 
      class="form-control origin-field-input" 
      placeholder="역 이름 또는 주소 (예: 강남역)" 
      value="${escapeHtml(originVal)}"
    >
  `;

  const input = row.querySelector('input');
  
  const handleSaveOrigin = async () => {
    const val = input.value.trim();
    try {
      const res = await fetch(`/api/rooms/${ROOM_ID}/origin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, origin: val })
      });
      if (res.ok) {
        showToast(`'${name}'님의 출발지('${val || '미입력'}')가 저장되었습니다.`);
        if (currentRoom) {
          if (!currentRoom.participants) currentRoom.participants = {};
          if (!currentRoom.participants[name]) {
            currentRoom.participants[name] = { name: name, available_slots: [], origin: val };
          } else {
            currentRoom.participants[name].origin = val;
            delete currentRoom.participants[name].lat;
            delete currentRoom.participants[name].lng;
          }
        }
      } else {
        showToast('출발지 저장에 실패했습니다.');
      }
    } catch (e) {
      console.error(e);
      showToast('출발지 저장 중 통신 오류가 발생했습니다.');
    }
  };

  input.addEventListener('change', handleSaveOrigin);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      input.blur();
    }
  });

  container.appendChild(row);
}
