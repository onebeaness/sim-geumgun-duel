"""Page 3 — 수제 대시보드."""
import pandas as pd
import plotly.express as px
import streamlit as st

from lib import db

pid = st.session_state.get("player_uuid")
if not pid:
    st.warning("먼저 결투장에서 한 판 플레이하세요."); st.stop()
    
df = pd.DataFrame(db.fetch_player_defense_turns(pid, "solo"))
if df.empty:
    st.warning("아직 기록이 없어요."); st.stop()

r = df["reaction_ms"].dropna()
median  = r.median()
fastest = r.min()
mean    = r.mean()
    
st.header("🎮 핵심 지표")
c1, c2, c3 = st.columns(3)
c1.metric("중앙값", f"{median:.0f}ms")
c2.metric("최고",   f"{fastest:.0f}ms")
c3.metric("평균",   f"{mean:.0f}ms")