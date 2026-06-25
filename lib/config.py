"""게임 전역 상수 — 기획 확정값을 한 곳에서 관리.

이 값들은 Phase 1 에서 JSON 으로 직렬화되어 게임 컴포넌트(JS)에도 전달됩니다.
"""

# --- 승부 (목숨 3개) ---
LIVES = 3  # 방어 실패 또는 공격 타임아웃 시 -1, 0 이 되면 패배

# --- 방향 ---
DIRECTIONS = ["left", "center", "right"]
# 동시 지원: 화살표(←↑↓→) + ASD/W. 중앙은 상단(↑/W)·하단(↓/S) 아무거나.
KEY_MAP = {
    "ArrowLeft": "left", "ArrowRight": "right",
    "ArrowUp": "center", "ArrowDown": "center",
    "a": "left", "d": "right", "w": "center", "s": "center",
}

# --- 공격자 커밋 / 타임아웃 ---
COMMIT_TIMEOUT_MS = 3000  # 공격자 방향 선택 제한(3초). 초과 시 타임아웃 1회 + 역할 교대
TIMEOUTS_PER_LIFE = 2     # 타임아웃 2회마다 목숨 1개 소진
DISCONNECT_CONSECUTIVE_TIMEOUT_LIVES = 2  # 타임아웃發 목숨소진 2회 연속 → 연결끊김(기록 미반영)

# --- 속도 램프 (적응형, 방어자별 독립) ---
WINDOW_INIT_MS = 800       # 첫 교환 허용시간 (실력검정 결과 있으면 그 값으로 시드)
WINDOW_MIN_MS = 250        # 인간 불가능 영역 방지 하한
WINDOW_MAX_MS = 1200       # 초반 난이도 보장 상한
RAMP_FACTOR = 1.5          # window = clamp(최근평균반응 * 1.5, MIN, MAX)
RAMP_LOOKBACK = 3          # 최근 N회 방어 반응의 평균 사용

# --- 큐 / 반응 측정 ---
PRECUE_DELAY_MIN_MS = 300  # 큐 등장 전 랜덤 대기(앵커링/예측 방지)
PRECUE_DELAY_MAX_MS = 1200
MIN_VALID_REACTION_MS = 100  # 이 미만은 부정으로 보고 거부 → "너무 빨랐음" + 그 교환 재시도

# --- 봇 (난이도별 반응 분포 ms / 오답률) ---
BOT_PROFILES = {
    "easy":   {"label": "쉬움",   "mean": 650, "std": 120, "wrong_rate": 0.25},
    "normal": {"label": "보통",   "mean": 450, "std": 90,  "wrong_rate": 0.12},
    "hard":   {"label": "어려움", "mean": 300, "std": 60,  "wrong_rate": 0.04},
}

# --- 레이팅 (PvP 에서만 변동) ---
RATING_BASE = 1000
RATING_K = 32
PLACEMENT_TRIALS = 5  # 실력검정 측정 횟수 → 초기 레이팅·난이도 시드

# --- 닉네임 ---
NICK_MIN_LEN = 2
NICK_MAX_LEN = 12  # 이모지 1개 = 1자, 특수문자 불가

# --- 매칭 (PvP / Phase 3) ---
MATCH_RATING_PHASE_SEC = 8  # 이 시간까지 레이팅 근접 매칭, 이후 FIFO(아무나)
# 연결 두절/브라우저 닫기: v1 은 몰수패 없이 '기록 미반영'(패배 회피 허용). Phase 4 재검토.


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def next_window_ms(recent_reactions):
    """방어자의 최근 반응(ms) 리스트로 다음 교환 허용시간을 계산."""
    if not recent_reactions:
        return WINDOW_INIT_MS
    recent = recent_reactions[-RAMP_LOOKBACK:]
    avg = sum(recent) / len(recent)
    return clamp(avg * RAMP_FACTOR, WINDOW_MIN_MS, WINDOW_MAX_MS)


def as_component_config():
    """게임 컴포넌트(JS)로 넘길 설정 묶음."""
    return {
        "lives": LIVES,
        "directions": DIRECTIONS,
        "keyMap": KEY_MAP,
        "commitTimeoutMs": COMMIT_TIMEOUT_MS,
        "window": {
            "initMs": WINDOW_INIT_MS, "minMs": WINDOW_MIN_MS,
            "maxMs": WINDOW_MAX_MS, "factor": RAMP_FACTOR, "lookback": RAMP_LOOKBACK,
        },
        "precue": {"minMs": PRECUE_DELAY_MIN_MS, "maxMs": PRECUE_DELAY_MAX_MS},
        "minValidReactionMs": MIN_VALID_REACTION_MS,
        "timeout": {
            "perLife": TIMEOUTS_PER_LIFE,
            "disconnectConsecLives": DISCONNECT_CONSECUTIVE_TIMEOUT_LIVES,
        },
        "botProfiles": BOT_PROFILES,
    }
