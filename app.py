"""심: 금군 듀얼 — 멀티페이지 네비게이션 엔트리.

실행:  streamlit run app.py
"""
import streamlit as st

st.set_page_config(page_title="심: 금군 듀얼", page_icon="⚔️", layout="wide")

lobby = st.Page("views/lobby.py", title="결투장", icon="⚔️", default=True)
tutorial = st.Page("views/tutorial.py", title="실력 검정", icon="🎯")
dashboard = st.Page("views/dashboard.py", title="대시보드", icon="📊")
mydashboard = st.Page("views/selfdashboard.py", title="수제대시보드")
st.navigation([lobby, tutorial, dashboard, mydashboard]).run()
