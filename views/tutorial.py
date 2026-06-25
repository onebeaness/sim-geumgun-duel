"""Page — 실력 검정(튜토리얼). 반응속도 N회 측정 → 초기 레이팅·난이도 시드."""
import streamlit as st

from lib import config

st.title("🎯 실력 검정")
st.write(
    f"반응속도를 **{config.PLACEMENT_TRIALS}회** 측정해 초기 레이팅과 난이도 시드를 정합니다. "
    "이 페이지의 측정 루프는 **Phase 1** 에서 게임 컴포넌트로 구현됩니다."
)
st.caption("레이팅 변동은 PvP 에서만 일어납니다(솔로 vs 봇은 레이팅 무변동).")
