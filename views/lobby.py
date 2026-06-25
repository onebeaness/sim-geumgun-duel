"""Page 1 — 로비 / 플레이."""
import uuid

import streamlit as st

from lib import config
from game_component import duel_arena

st.title("⚔️ 심: 금군 듀얼")
st.caption("공격과 방어를 번갈아 — 더 빨리, 더 정확히 막는 자가 살아남는다.")

# --- 익명 신원 (UUID + 닉네임). Phase 2 에서 브라우저 localStorage 로 영속화 ---
if "player_uuid" not in st.session_state:
    st.session_state.player_uuid = str(uuid.uuid4())

nickname = st.text_input(
    "닉네임",
    value=st.session_state.get("nickname", ""),
    max_chars=config.NICK_MAX_LEN,
    placeholder=f"{config.NICK_MIN_LEN}~{config.NICK_MAX_LEN}자 (특수문자 불가)",
)
if nickname:
    st.session_state.nickname = nickname

st.divider()

mode = st.radio("모드", ["솔로 플레이", "온라인 매칭"], horizontal=True)

if mode == "솔로 플레이":
    label_to_key = {p["label"]: k for k, p in config.BOT_PROFILES.items()}
    diff_label = st.selectbox("봇 난이도", list(label_to_key.keys()), index=1)
    difficulty = label_to_key[diff_label]

    ready = bool(nickname) and len(nickname) >= config.NICK_MIN_LEN
    if st.button("결투 시작", type="primary", disabled=not ready):
        st.session_state.in_duel = True
        st.session_state.difficulty = difficulty

    if st.session_state.get("in_duel"):
        st.caption(
            "아레나를 **클릭**한 뒤 ← ↓ → (또는 A S D)로 플레이 · "
            "공격 차례엔 방향을 고르고, 방어 차례엔 상대 공격 방향을 막으세요."
        )
        result = duel_arena(
            mode="solo",
            difficulty=st.session_state.get("difficulty", "normal"),
            config=config.as_component_config(),
            key="arena",
        )

        if isinstance(result, dict):
            ev = result.get("event")
            if ev == "matchEnd":
                won = result.get("winner") == "player"
                avg = result.get("avgReaction")
                best = result.get("bestReaction")
                line = (
                    f"교환 {result.get('exchanges')}회 · "
                    f"평균 반응 {avg if avg is not None else '—'}ms · "
                    f"최고 {best if best is not None else '—'}ms"
                )
                if won:
                    st.success(f"🏆 **승리** — {line}")
                else:
                    st.error(f"💀 **패배** — {line}")
                st.caption("Phase 2 에서 이 결과가 Supabase 에 저장됩니다.")
            elif ev == "matchVoid":
                st.warning(f"⚠️ 기록 미반영 — {result.get('reason')}")

        if st.button("결투 종료 (로비로)"):
            st.session_state.in_duel = False
            st.rerun()
else:
    st.info("온라인 매칭은 Phase 3 에서 구현됩니다.")
