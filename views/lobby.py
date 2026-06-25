"""Page 1 — 로비 / 플레이."""
import uuid

import streamlit as st

from lib import config, db
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

            # --- 결과 저장 (rerun 중복 방지: ts 로 dedup) ---
            if ev in ("matchEnd", "matchVoid"):
                sig = f"{ev}:{result.get('ts')}"
                if st.session_state.get("_last_saved") != sig:
                    st.session_state["_last_saved"] = sig
                    if db.is_enabled():
                        match_id = str(uuid.uuid4())
                        db.upsert_player(
                            st.session_state.player_uuid,
                            st.session_state.get("nickname", "익명"),
                        )
                        winner = None if ev == "matchVoid" else (
                            "a" if result.get("winner") == "player" else "b"
                        )
                        db.save_match(
                            match_id, st.session_state.player_uuid, "solo",
                            st.session_state.get("difficulty"), winner,
                            voided=(ev == "matchVoid"),
                            exchanges=result.get("exchanges"),
                            avg_ms=result.get("avgReaction"),
                            best_ms=result.get("bestReaction"),
                        )
                        db.save_turns(match_id, result.get("turns") or [])
                        st.session_state["_saved_note"] = (
                            "void" if ev == "matchVoid" else "ok"
                        )
                    else:
                        st.session_state["_saved_note"] = "disabled"

            # --- 결과 카드 ---
            if ev == "matchEnd":
                won = result.get("winner") == "player"
                avg = result.get("avgReaction")
                best = result.get("bestReaction")
                line = (
                    f"교환 {result.get('exchanges')}회 · "
                    f"평균 반응 {avg if avg is not None else '—'}ms · "
                    f"최고 {best if best is not None else '—'}ms"
                )
                (st.success if won else st.error)(
                    f"{'🏆 **승리**' if won else '💀 **패배**'} — {line}"
                )
            elif ev == "matchVoid":
                st.warning(f"⚠️ 기록 미반영 — {result.get('reason')}")

            note = st.session_state.get("_saved_note")
            if note == "ok":
                st.caption("✅ 전적이 Supabase 에 저장됐습니다. · 대시보드에서 확인하세요.")
            elif note == "void":
                st.caption("기록 미반영 매치 — 저장되지 않았습니다.")
            elif note == "disabled":
                st.caption("ℹ️ DB 미설정(secrets 없음) — 저장 생략. 솔로 플레이는 정상입니다.")
            if st.session_state.get("_db_error"):
                st.caption(f"⚠️ 저장 경고: {st.session_state['_db_error']}")

        if st.button("결투 종료 (로비로)"):
            st.session_state.in_duel = False
            st.rerun()
else:
    st.info("온라인 매칭은 Phase 3 에서 구현됩니다.")
